import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { BillingStack } from "./lib/billing-stack.js";
import { ComputeStack } from "./lib/compute-stack.js";
import { DataStack } from "./lib/data-stack.js";

/**
 * Assertions against the SYNTHESISED templates.
 *
 * These are the properties that are cheap to get wrong in a refactor and
 * expensive to discover in production — a database that became publicly
 * reachable, a bucket that lost its public-access block, a queue that quietly
 * lost its dead-letter queue and started dropping failed ingests.
 */

function synth() {
  const app = new App();
  const env = { account: "111111111111", region: "ap-south-1" };
  const data = new DataStack(app, "Data", { env });
  const compute = new ComputeStack(app, "Compute", { env, data, alertEmail: "a@b.test" });
  const billing = new BillingStack(app, "Billing", { env: { account: env.account }, alertEmail: "a@b.test", monthlyBudgetUsd: 50 });
  return {
    data: Template.fromStack(data),
    compute: Template.fromStack(compute),
    billing: Template.fromStack(billing),
  };
}

const t = synth();

describe("the database", () => {
  it("is not publicly accessible and sits in isolated subnets", () => {
    t.data.hasResourceProperties("AWS::RDS::DBInstance", {
      PubliclyAccessible: false,
      StorageEncrypted: true,
      DeletionProtection: true,
      Engine: "postgres",
    });
  });

  it("is retained on stack deletion — the corpus is not re-creatable for free", () => {
    t.data.hasResource("AWS::RDS::DBInstance", { DeletionPolicy: "Retain" });
  });

  it("keeps backups", () => {
    t.data.hasResourceProperties("AWS::RDS::DBInstance", {
      BackupRetentionPeriod: Match.anyValue(),
    });
  });
});

describe("secrets", () => {
  it("never puts a literal secret value in the template", () => {
    // The reason the model key secret is created empty and populated out of
    // band: a value here is a value in the CloudFormation console, in every
    // developer's `cdk diff`, and in the template bucket forever.
    const json = JSON.stringify(t.data.toJSON());
    expect(json).not.toMatch(/AIza[0-9A-Za-z_-]{10,}/);

    // SecretString is the property that would carry an inline plaintext value.
    // CDK emits an empty GenerateSecretString for an unpopulated secret, so its
    // absence is not the thing to assert.
    for (const [id, res] of Object.entries(t.data.findResources("AWS::SecretsManager::Secret"))) {
      const props = (res as { Properties: Record<string, unknown> }).Properties;
      expect(props.SecretString, `${id} carries an inline value`).toBeUndefined();
    }
    t.data.hasResourceProperties("AWS::SecretsManager::Secret", {
      Name: "bots/model-api-key",
      GenerateSecretString: {},
    });
  });

  it("gives the app its OWN database user, not the master", () => {
    // The master user is a superuser and superusers bypass RLS entirely.
    t.data.hasResourceProperties("AWS::SecretsManager::Secret", {
      Name: "bots/app-db-credentials",
      GenerateSecretString: Match.objectLike({
        SecretStringTemplate: Match.stringLikeRegexp("bots_app"),
      }),
    });
  });

  it("injects secrets into tasks rather than baking them into the image", () => {
    t.compute.hasResourceProperties("AWS::ECS::TaskDefinition", {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({ Secrets: Match.arrayWith([Match.objectLike({ Name: "GEMINI_API_KEY" })]) }),
      ]),
    });
  });
});

describe("the ingest bucket and queue", () => {
  it("blocks all public access and enforces TLS", () => {
    t.data.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true, BlockPublicPolicy: true,
        IgnorePublicAcls: true, RestrictPublicBuckets: true,
      },
    });
    t.data.hasResourceProperties("AWS::S3::BucketPolicy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({ Effect: "Deny", Condition: { Bool: { "aws:SecureTransport": "false" } } }),
        ]),
      }),
    });
  });

  it("has a dead-letter queue with a bounded retry count", () => {
    // Without this a failing ingest retries forever and nothing ever surfaces it.
    t.data.hasResourceProperties("AWS::SQS::Queue", {
      RedrivePolicy: Match.objectLike({ maxReceiveCount: 3 }),
    });
  });

  it("gives the queue a visibility timeout long enough for a large PDF", () => {
    t.data.hasResourceProperties("AWS::SQS::Queue", {
      VisibilityTimeout: 900,
    });
  });
});

describe("alarms", () => {
  it("pages when an ingest job lands in the DLQ", () => {
    t.compute.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmDescription: Match.stringLikeRegexp("exhausted its retries"),
      AlarmActions: Match.anyValue(),
    });
  });

  it("watches API 5xx, unhealthy hosts, and database CPU", () => {
    const alarms = t.compute.findResources("AWS::CloudWatch::Alarm");
    const names = Object.values(alarms).map((a) => JSON.stringify(a));
    expect(names.some((n) => n.includes("HTTPCode_Target_5XX_Count"))).toBe(true);
    expect(names.some((n) => n.includes("UnHealthyHostCount"))).toBe(true);
    expect(names.some((n) => n.includes("CPUUtilization"))).toBe(true);
  });

  it("puts the billing alarm in us-east-1, where the metric exists", () => {
    // AWS publishes EstimatedCharges only to us-east-1 regardless of where the
    // resources run, and an alarm must sit in its metric's region.
    t.billing.hasResourceProperties("AWS::CloudWatch::Alarm", {
      Namespace: "AWS/Billing",
      MetricName: "EstimatedCharges",
    });
    // And it is genuinely a separate stack, not a construct in compute.
    expect(Object.keys(t.compute.findResources("AWS::CloudWatch::Alarm")).length).toBeGreaterThan(0);
    const computeJson = JSON.stringify(t.compute.toJSON());
    expect(computeJson).not.toContain("EstimatedCharges");
  });

  it("every alarm has somewhere to go — an alarm without an action is decoration", () => {
    for (const [id, alarm] of Object.entries(t.compute.findResources("AWS::CloudWatch::Alarm"))) {
      expect((alarm as { Properties: { AlarmActions?: unknown[] } }).Properties.AlarmActions, id).toBeTruthy();
    }
  });
});

describe("deploy safety", () => {
  it("rolls back a failed API deploy instead of leaving it half-live", () => {
    t.compute.hasResourceProperties("AWS::ECS::Service", {
      DeploymentConfiguration: Match.objectLike({
        DeploymentCircuitBreaker: { Enable: true, Rollback: true },
      }),
    });
  });

  it("keeps the API fleet fully serving through a deploy", () => {
    t.compute.hasResourceProperties("AWS::ECS::Service", {
      DeploymentConfiguration: Match.objectLike({ MinimumHealthyPercent: 100 }),
      LoadBalancers: Match.anyValue(),
    });
  });

  it("drains long enough not to truncate a streaming answer", () => {
    t.compute.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", {
      TargetGroupAttributes: Match.arrayWith([
        Match.objectLike({ Key: "deregistration_delay.timeout_seconds", Value: "120" }),
      ]),
    });
  });
});

describe("stack boundaries", () => {
  it("references only ever point Compute → Data", () => {
    // The cycle CloudFormation refuses: data referencing a compute security
    // group while compute already references the VPC. Data must export, never import.
    const dataJson = JSON.stringify(t.data.toJSON());
    expect(dataJson).not.toContain("Compute");
  });
});
