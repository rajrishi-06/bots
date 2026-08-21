#!/usr/bin/env tsx
import { App } from "aws-cdk-lib";
import { BillingStack } from "../lib/billing-stack.js";
import { ComputeStack } from "../lib/compute-stack.js";
import { DataStack } from "../lib/data-stack.js";

const app = new App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? "ap-south-1",
};

const data = new DataStack(app, "Bots-Data", { env });

const alertEmail = process.env.ALERT_EMAIL ?? "rajrishireddyk@gmail.com";

new ComputeStack(app, "Bots-Compute", { env, data, alertEmail });

// Separate stack because AWS/Billing metrics exist only in us-east-1 and an
// alarm must sit in its metric's region. Deliberately low: the point is to
// notice a runaway ingest loop within hours, not after a month.
new BillingStack(app, "Bots-Billing", {
  env: { account: env.account },
  alertEmail,
  monthlyBudgetUsd: Number(process.env.MONTHLY_BUDGET_USD ?? 50),
});
