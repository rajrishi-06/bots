import {
  aws_cloudwatch as cw,
  aws_cloudwatch_actions as cwActions,
  aws_sns as sns,
  aws_sns_subscriptions as subs,
  Duration,
  Stack,
  type StackProps,
} from "aws-cdk-lib";
import type { Construct } from "constructs";

export interface BillingStackProps extends StackProps {
  alertEmail: string;
  monthlyBudgetUsd: number;
}

/**
 * The spend alarm, in its own stack, pinned to us-east-1.
 *
 * AWS publishes AWS/Billing EstimatedCharges to us-east-1 ONLY, wherever the
 * resources actually run, and CloudWatch refuses an alarm whose metric is in a
 * different region. The SNS topic has to live there too, since topics are
 * regional — which is why this cannot just be a construct in the compute stack.
 *
 * It exists because a runaway ingest loop should page within hours rather than
 * quietly consume the provider-side cap: that cap stops the bleeding but says
 * nothing about why it started.
 */
export class BillingStack extends Stack {
  constructor(scope: Construct, id: string, props: BillingStackProps) {
    super(scope, id, { ...props, env: { ...props.env, region: "us-east-1" } });

    const topic = new sns.Topic(this, "BillingAlarms", { displayName: "bots billing" });
    topic.addSubscription(new subs.EmailSubscription(props.alertEmail));

    new cw.Alarm(this, "MonthlySpend", {
      metric: new cw.Metric({
        namespace: "AWS/Billing",
        metricName: "EstimatedCharges",
        dimensionsMap: { Currency: "USD" },
        statistic: "Maximum",
        // EstimatedCharges updates only every few hours; a shorter period just
        // re-reads the same datapoint.
        period: Duration.hours(6),
      }),
      threshold: props.monthlyBudgetUsd,
      evaluationPeriods: 1,
      alarmDescription: `Estimated AWS charges above $${props.monthlyBudgetUsd}.`,
      treatMissingData: cw.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(new cwActions.SnsAction(topic));
  }
}
