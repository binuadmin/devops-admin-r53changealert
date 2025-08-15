#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { R53ChangeAlertStack } from '../lib/r53changealert-stack';
import * as yaml from 'js-yaml';
import * as fs from 'fs';

const app = new cdk.App();

// Get values from context (passed from deploy script)
const project = app.node.tryGetContext('project');
const environment = app.node.tryGetContext('environment');
const service = app.node.tryGetContext('service');
const version = app.node.tryGetContext('version');

// Load vars file
const varsFile = `vars/${environment}.yml`;
const varsContent = yaml.load(fs.readFileSync(varsFile, 'utf8')) as any;

new R53ChangeAlertStack(app, `${project.toUpperCase()}-${environment.toUpperCase()}-R53CHANGEALERT`, {
  project,
  environment,
  service,
  version,
  generalNotificationTopic: varsContent.generalNotificationTopic,
});
