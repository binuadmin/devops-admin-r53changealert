#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { R53ChangeAlertStack } from '../lib/r53changealert-stack';
import * as yaml from 'js-yaml';
import * as fs from 'fs';

const app = new cdk.App();

const project = 'admin';
const environment = process.env.ENVIRONMENT || 'systest';
const service = 'r53changealert';
const version = '1.0.0';

// Load vars file (same pattern as lambdas project)
const varsFile = `vars/${environment}.yml`;
const varsContent = yaml.load(fs.readFileSync(varsFile, 'utf8')) as any;

new R53ChangeAlertStack(app, `${project.toUpperCase()}-${environment.toUpperCase()}-R53CHANGEALERT`, {
  project,
  environment,
  service,
  version,
  generalNotificationTopic: varsContent.generalNotificationTopic,
});
