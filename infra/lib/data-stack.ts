import {
  aws_ec2 as ec2,
  aws_elasticache as elasticache,
  aws_rds as rds,
  aws_s3 as s3,
  aws_secretsmanager as secrets,
  aws_sqs as sqs,
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
} from "aws-cdk-lib";
import type { Construct } from "constructs";

/**
 * Everything with state, in its own stack.
 *
 * Split from compute for one reason: `cdk deploy Bots-Compute` then cannot
 * touch the database. Deploying a new API image is the operation that happens
 * dozens of times a week, and it should be incapable of replacing an RDS
 * instance no matter what a template change implies.
 */
export class DataStack extends Stack {
  readonly vpc: ec2.Vpc;
  readonly database: rds.DatabaseInstance;
  readonly redis: elasticache.CfnCacheCluster;
  readonly ingestBucket: s3.Bucket;
  readonly ingestQueue: sqs.Queue;
  readonly ingestDlq: sqs.Queue;
  readonly modelApiKey: secrets.Secret;
  readonly appDbSecret: secrets.Secret;
  /**
   * Security group IDS, deliberately exposed as strings rather than constructs.
   *
   * Compute imports these with `fromSecurityGroupId({ mutable: true })` and adds
   * its own ingress rules, which places those rule RESOURCES in the compute
   * stack. Handing over the construct instead would place them here — this
   * stack would then reference a compute-stack security group while compute
   * already references this VPC, and CloudFormation refuses the cycle.
   *
   * References may only ever point Compute → Data.
   */
  readonly databaseSecurityGroupId: string;
  readonly redisSecurityGroupId: string;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      // One NAT, not one per AZ. A second costs ~$32/month to protect against
      // an AZ outage that a single-region MVP does not otherwise survive.
      natGateways: 1,
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: "private", subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        { name: "isolated", subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });

    /* ── Secrets ─────────────────────────────────────────────────────────── */

    // Created EMPTY and filled by hand. A key in a CDK template is a key in
    // CloudFormation's console, in every developer's `cdk diff`, and in the
    // state bucket forever.
    this.modelApiKey = new secrets.Secret(this, "ModelApiKey", {
      secretName: "bots/model-api-key",
      description: "GEMINI_API_KEY. Populate manually: aws secretsmanager put-secret-value.",
    });

    /* ── Postgres ────────────────────────────────────────────────────────── */

    const dbSg = new ec2.SecurityGroup(this, "DatabaseSg", {
      vpc: this.vpc,
      description: "postgres",
      allowAllOutbound: false,
    });

    this.database = new rds.DatabaseInstance(this, "Database", {
      securityGroups: [dbSg],
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16_4 }),
      vpc: this.vpc,
      // Isolated: the database has no route to the internet in either direction.
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MEDIUM),
      allocatedStorage: 50,
      maxAllocatedStorage: 200,
      storageEncrypted: true,
      multiAz: false,
      backupRetention: Duration.days(7),
      deletionProtection: true,
      // RETAIN so that destroying the stack cannot destroy the corpus. Every
      // customer's documents live here and re-ingesting them is not free.
      removalPolicy: RemovalPolicy.RETAIN,
      credentials: rds.Credentials.fromGeneratedSecret("bots_master"),
      parameters: {
        // pgvector ships with RDS Postgres 16 but the extension must be created
        // per-database; migrations do that (see packages/db/src/migrate.ts).
        shared_preload_libraries: "pg_stat_statements",
      },
      cloudwatchLogsExports: ["postgresql"],
    });
    this.databaseSecurityGroupId = dbSg.securityGroupId;

    /**
     * The APPLICATION database user, which is NOT the master user.
     *
     * The master user is a superuser, and superusers bypass row-level security
     * even with FORCE — every tenant-isolation policy in the schema would be
     * inert if the API connected with it. This secret is created empty and the
     * role is provisioned by migrations; the API is given only this one.
     */
    this.appDbSecret = new secrets.Secret(this, "AppDbSecret", {
      secretName: "bots/app-db-credentials",
      description: "bots_app password. NOT the master user — the master bypasses RLS.",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "bots_app" }),
        generateStringKey: "password",
        excludePunctuation: true,
        passwordLength: 32,
      },
    });

    /* ── Redis ───────────────────────────────────────────────────────────── */

    const redisSubnets = new elasticache.CfnSubnetGroup(this, "RedisSubnets", {
      description: "bots redis",
      subnetIds: this.vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }).subnetIds,
    });
    const redisSg = new ec2.SecurityGroup(this, "RedisSg", { vpc: this.vpc, allowAllOutbound: false });
    this.redisSecurityGroupId = redisSg.securityGroupId;
    this.redis = new elasticache.CfnCacheCluster(this, "Redis", {
      engine: "redis",
      cacheNodeType: "cache.t4g.micro",
      numCacheNodes: 1,
      cacheSubnetGroupName: redisSubnets.ref,
      vpcSecurityGroupIds: [redisSg.securityGroupId],
    });
    this.redis.addDependency(redisSubnets);

    /* ── Ingest ──────────────────────────────────────────────────────────── */

    this.ingestBucket = new s3.Bucket(this, "IngestBucket", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      // Browsers upload straight here with a presigned PUT, so the bucket must
      // accept the preflight. Origins are restricted at the API, which is what
      // issues the URL in the first place.
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT],
          allowedOrigins: ["*"],
          allowedHeaders: ["*"],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [
        // The parsed text lives in Postgres; the original is kept for re-parsing
        // with a better extractor, which does not need hot storage.
        { transitions: [{ storageClass: s3.StorageClass.INFREQUENT_ACCESS, transitionAfter: Duration.days(30) }] },
        { abortIncompleteMultipartUploadAfter: Duration.days(3) },
      ],
      removalPolicy: RemovalPolicy.RETAIN,
    });

    this.ingestDlq = new sqs.Queue(this, "IngestDlq", {
      retentionPeriod: Duration.days(14),
      enforceSSL: true,
    });

    this.ingestQueue = new sqs.Queue(this, "IngestQueue", {
      // Longer than the worker's VisibilityTimeout so a slow PDF is not handed
      // to a second consumer while the first is still working on it.
      visibilityTimeout: Duration.minutes(15),
      retentionPeriod: Duration.days(4),
      enforceSSL: true,
      deadLetterQueue: { queue: this.ingestDlq, maxReceiveCount: 3 },
    });

    new CfnOutput(this, "DatabaseEndpoint", { value: this.database.dbInstanceEndpointAddress });
    new CfnOutput(this, "RedisEndpoint", { value: this.redis.attrRedisEndpointAddress });
    new CfnOutput(this, "IngestBucketName", { value: this.ingestBucket.bucketName });
    new CfnOutput(this, "IngestQueueUrl", { value: this.ingestQueue.queueUrl });
  }
}
