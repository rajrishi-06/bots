# @bots/infra

AWS CDK. Three stacks.

```bash
pnpm --filter @bots/infra test     # assertions against the synthesised templates
pnpm --filter @bots/infra synth
pnpm --filter @bots/infra diff
```

| Stack | Region | Holds |
| --- | --- | --- |
| `Bots-Data` | app region | VPC, RDS Postgres 16, ElastiCache, S3, SQS + DLQ, secrets |
| `Bots-Compute` | app region | ECS API behind an ALB, ingest worker, widget CDN, alarms |
| `Bots-Billing` | **us-east-1** | The spend alarm |

## Why three, and why references only point one way

Compute is redeployed dozens of times a week and must be **incapable** of
touching the database, whatever a template change implies.

That constraint is stricter than it sounds. Compute references Data's VPC, so
Data may never reference Compute — and the obvious wiring does exactly that:
`database.connections.allowDefaultPortFrom(api.service)` creates the ingress
rule in the *data* stack pointing at a *compute* security group, and
CloudFormation rejects the cycle. Data therefore exports security group **IDs**,
and Compute imports them with `fromSecurityGroupId({ mutable: true })` so the
rules are created on Compute's side. A test asserts the data template contains
no reference to compute at all.

`Bots-Billing` is separate for a different reason: AWS publishes
`AWS/Billing EstimatedCharges` to us-east-1 only, wherever the resources
actually run, and an alarm must live in its metric's region. SNS topics are
regional too, so the topic has to move with it.

## Deploy order

```bash
export CDK_DEFAULT_ACCOUNT=… CDK_DEFAULT_REGION=ap-south-1
pnpm --filter @bots/infra exec cdk bootstrap
pnpm --filter @bots/infra exec cdk deploy Bots-Data
# Populate the model key — deliberately NOT in the template
aws secretsmanager put-secret-value --secret-id bots/model-api-key --secret-string 'AIza…'
# Create the bots_app role with the generated password, then run migrations
pnpm --filter @bots/db migrate
pnpm --filter @bots/infra exec cdk deploy Bots-Compute Bots-Billing
```

## Notes that are easy to lose

- The **master database user is a superuser and bypasses RLS.** The API is given
  `bots/app-db-credentials` (`bots_app`), never the master secret.
- The ALB idle timeout is 180s and deregistration delay is 120s because answers
  are streamed; the defaults truncate a reply mid-sentence during a deploy.
- The image assets build from the **repo root**, because pnpm workspace packages
  are symlinks a per-app context cannot follow. `.dockerignore` excludes
  `cdk.out` — without it, staging recurses into itself until the path is too long.
- One NAT gateway, not one per AZ. The second costs ~$32/month to protect
  against an AZ outage a single-region deployment does not otherwise survive.
