import {
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_cloudwatch as cw,
  aws_cloudwatch_actions as cwActions,
  aws_ec2 as ec2,
  aws_ecs as ecs,
  aws_ecs_patterns as ecsPatterns,
  aws_elasticloadbalancingv2 as elbv2,
  aws_s3 as s3,
  aws_sns as sns,
  aws_sns_subscriptions as subs,
  CfnOutput,
  Duration,
  Stack,
  type StackProps,
} from "aws-cdk-lib";
import type { Construct } from "constructs";
import type { DataStack } from "./data-stack.js";

export interface ComputeStackProps extends StackProps {
  data: DataStack;
  /** Where alarms go. Without one, alarms are decoration. */
  alertEmail: string;
}

/**
 * Stateless compute. Safe to redeploy constantly — it cannot touch the database.
 */
export class ComputeStack extends Stack {
  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);
    const { data } = props;

    const cluster = new ecs.Cluster(this, "Cluster", { vpc: data.vpc, containerInsightsV2: ecs.ContainerInsights.ENABLED });

    /**
     * Data's security groups, imported by ID so the ingress rules below are
     * created in THIS stack. Taking the constructs across instead would put the
     * rules in the data stack, which would then reference compute — and compute
     * already references the VPC, so CloudFormation rejects the cycle.
     */
    const dbSg = ec2.SecurityGroup.fromSecurityGroupId(this, "DbSg", data.databaseSecurityGroupId, {
      mutable: true,
    });
    const redisSg = ec2.SecurityGroup.fromSecurityGroupId(this, "RedisSg", data.redisSecurityGroupId, {
      mutable: true,
    });

    const alarms = new sns.Topic(this, "Alarms", { displayName: "bots alarms" });
    alarms.addSubscription(new subs.EmailSubscription(props.alertEmail));
    const notify = new cwActions.SnsAction(alarms);

    const commonEnv = {
      NODE_ENV: "production",
      INGEST_QUEUE_URL: data.ingestQueue.queueUrl,
      INGEST_BUCKET: data.ingestBucket.bucketName,
      REDIS_URL: `redis://${data.redis.attrRedisEndpointAddress}:${data.redis.attrRedisEndpointPort}`,
    };

    // Secrets are injected as ECS task secrets, resolved at container start from
    // Secrets Manager. They never appear in the task definition, in a .env file,
    // or in a container image layer.
    const commonSecrets = {
      GEMINI_API_KEY: ecs.Secret.fromSecretsManager(data.modelApiKey),
      DB_PASSWORD: ecs.Secret.fromSecretsManager(data.appDbSecret, "password"),
    };

    /* ── API ─────────────────────────────────────────────────────────────── */

    const api = new ecsPatterns.ApplicationLoadBalancedFargateService(this, "Api", {
      cluster,
      cpu: 512,
      memoryLimitMiB: 1024,
      desiredCount: 2,
      publicLoadBalancer: true,
      taskImageOptions: {
        image: ecs.ContainerImage.fromAsset("..", { file: "apps/api/Dockerfile" }),
        containerPort: 8080,
        environment: { ...commonEnv, PORT: "8080" },
        secrets: commonSecrets,
        logDriver: ecs.LogDrivers.awsLogs({ streamPrefix: "api" }),
      },
      // SSE responses are long-lived; the default 60s idle timeout cuts a
      // streaming answer off mid-sentence.
      idleTimeout: Duration.seconds(180),
      circuitBreaker: { rollback: true },
      // Explicit: keep the whole fleet serving through a deploy. The default is
      // 50%, which halves capacity exactly when a new image might be failing.
      minHealthyPercent: 100,
    });

    api.targetGroup.configureHealthCheck({
      path: "/health",
      interval: Duration.seconds(30),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3,
    });
    // Draining must outlast an in-flight streamed answer, or a deploy truncates
    // conversations that were mid-sentence.
    api.targetGroup.setAttribute("deregistration_delay.timeout_seconds", "120");

    api.service.autoScaleTaskCount({ minCapacity: 2, maxCapacity: 10 }).scaleOnCpuUtilization("Cpu", {
      targetUtilizationPercent: 60,
      scaleInCooldown: Duration.minutes(3),
    });

    dbSg.addIngressRule(api.service.connections.securityGroups[0]!, ec2.Port.tcp(5432), "api → postgres");
    redisSg.addIngressRule(api.service.connections.securityGroups[0]!, ec2.Port.tcp(6379), "api → redis");
    data.appDbSecret.grantRead(api.taskDefinition.taskRole);
    data.modelApiKey.grantRead(api.taskDefinition.taskRole);
    data.ingestBucket.grantPut(api.taskDefinition.taskRole); // presigned uploads
    data.ingestQueue.grantSendMessages(api.taskDefinition.taskRole);

    /* ── Worker ──────────────────────────────────────────────────────────── */

    const worker = new ecs.FargateService(this, "Worker", {
      cluster,
      // Ingest is bursty and nobody is waiting on a page render, so one task is
      // the right floor; it scales on queue depth below.
      desiredCount: 1,
      // A worker that rolls forward into a crash loop just drains the queue into
      // the DLQ; the breaker stops the deploy instead.
      circuitBreaker: { rollback: true },
      // 0 because ingest is asynchronous — nobody is waiting on a response, so
      // stopping the old task before starting the new one is fine and halves
      // the cost of a deploy.
      minHealthyPercent: 0,
      taskDefinition: (() => {
        const td = new ecs.FargateTaskDefinition(this, "WorkerTask", { cpu: 1024, memoryLimitMiB: 2048 });
        td.addContainer("worker", {
          image: ecs.ContainerImage.fromAsset("..", { file: "apps/worker/Dockerfile" }),
          environment: commonEnv,
          secrets: commonSecrets,
          logging: ecs.LogDrivers.awsLogs({ streamPrefix: "worker" }),
        });
        return td;
      })(),
    });

    dbSg.addIngressRule(worker.connections.securityGroups[0]!, ec2.Port.tcp(5432), "worker → postgres");
    redisSg.addIngressRule(worker.connections.securityGroups[0]!, ec2.Port.tcp(6379), "worker → redis");
    data.appDbSecret.grantRead(worker.taskDefinition.taskRole);
    data.modelApiKey.grantRead(worker.taskDefinition.taskRole);
    data.ingestBucket.grantRead(worker.taskDefinition.taskRole);
    data.ingestQueue.grantConsumeMessages(worker.taskDefinition.taskRole);

    worker.autoScaleTaskCount({ minCapacity: 1, maxCapacity: 8 }).scaleOnMetric("QueueDepth", {
      metric: data.ingestQueue.metricApproximateNumberOfMessagesVisible(),
      scalingSteps: [
        { upper: 0, change: -1 },
        { lower: 20, change: +2 },
        { lower: 100, change: +4 },
      ],
      cooldown: Duration.minutes(2),
    });

    /* ── Widget CDN ──────────────────────────────────────────────────────── */

    const widgetBucket = new s3.Bucket(this, "WidgetBucket", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
    });

    const cdn = new cloudfront.Distribution(this, "WidgetCdn", {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(widgetBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        // The loader is embedded on third-party sites, so the CDN must answer
        // their preflight before the API ever sees a request.
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS,
        compress: true,
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });

    /* ── Alarms ──────────────────────────────────────────────────────────── */

    // A message in the DLQ means an ingest failed every retry. Nobody finds that
    // by looking, so it pages.
    data.ingestDlq
      .metricApproximateNumberOfMessagesVisible()
      .createAlarm(this, "DlqNotEmpty", {
        threshold: 1,
        evaluationPeriods: 1,
        alarmDescription: "An ingest job exhausted its retries.",
        treatMissingData: cw.TreatMissingData.NOT_BREACHING,
      })
      .addAlarmAction(notify);

    // 5xx from the TASKS, not from the load balancer: an ELB 5xx usually means
    // no healthy target, which the health check alarm already covers. A target
    // 5xx means the application itself is failing requests.
    new cw.Alarm(this, "Api5xx", {
      metric: api.targetGroup.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, {
        period: Duration.minutes(5),
        statistic: "Sum",
      }),
      threshold: 5,
      evaluationPeriods: 2,
      alarmDescription: "The API is returning 5xx.",
      treatMissingData: cw.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(notify);

    new cw.Alarm(this, "ApiUnhealthyHosts", {
      metric: api.targetGroup.metrics.unhealthyHostCount({ period: Duration.minutes(1) }),
      threshold: 1,
      evaluationPeriods: 3,
      alarmDescription: "An API task is failing its health check.",
      treatMissingData: cw.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(notify);

    new cw.Alarm(this, "RdsCpu", {
      metric: data.database.metricCPUUtilization({ period: Duration.minutes(5) }),
      threshold: 80,
      evaluationPeriods: 3,
      alarmDescription: "Database CPU sustained above 80%.",
    }).addAlarmAction(notify);

    new CfnOutput(this, "ApiUrl", { value: `https://${api.loadBalancer.loadBalancerDnsName}` });
    new CfnOutput(this, "WidgetCdnUrl", { value: `https://${cdn.distributionDomainName}` });
    new CfnOutput(this, "WidgetBucketName", { value: widgetBucket.bucketName });
  }
}
