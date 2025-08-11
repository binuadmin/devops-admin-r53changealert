import { Stack, StackProps, Tags, Duration } from 'aws-cdk-lib';
import { Rule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

interface R53ChangeAlertStackProps extends StackProps {
  project: string;
  environment: string;
  service: string;
  version: string;
}

export class R53ChangeAlertStack extends Stack {
  constructor(scope: Construct, id: string, props: R53ChangeAlertStackProps) {
    super(scope, id, props);

    const PROJECT = props.project.toUpperCase();
    const project = props.project.toLowerCase();
    const ENVIRONMENT = props.environment.toUpperCase();
    const environment = props.environment.toLowerCase();
    const SERVICE = props.service.toUpperCase();
    const service = props.service.toLowerCase();

    // SNS topic configuration for each environment
    const generalNotificationTopic = ENVIRONMENT === 'PRODVIR' 
      ? `arn:aws:sns:us-east-1:${this.account}:admin-prod-events-general`
      : `arn:aws:sns:us-east-1:${this.account}:MONITORING-SYSTEST-events-general`; // ← Updated for SYSTEST

    // Environment-specific Lambda code
    const lambdaCode = ENVIRONMENT === 'PRODVIR' 
      ? `
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const snsClient = new SNSClient({ region: 'us-east-1' });

exports.handler = async (event) => {
    console.log('Received Route 53 event from MASTER account:', JSON.stringify(event, null, 2));
    
    const message = {
        eventTime: event.time,
        eventName: event.detail?.eventName || 'Unknown',
        eventSource: event.detail?.eventSource || 'Unknown',
        sourceIPAddress: event.detail?.sourceIPAddress || 'Unknown',
        userIdentity: event.detail?.userIdentity || {},
        requestParameters: event.detail?.requestParameters || {},
        responseElements: event.detail?.responseElements || {},
        accountId: event.account || 'Unknown'
    };
    
    const params = {
        TopicArn: process.env.GENERAL_NOTIFICATION_TOPIC,
        Subject: \`MASTER Account Route 53 Change Alert: \${message.eventName}\`,
        Message: JSON.stringify(message, null, 2)
    };
    
    try {
        const command = new PublishCommand(params);
        const result = await snsClient.send(command);
        console.log('Successfully published to SNS:', result.MessageId);
        return { statusCode: 200, body: 'Success' };
    } catch (error) {
        console.error('Failed to publish to SNS:', error);
        throw error;
    }
};
`
      : `
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const snsClient = new SNSClient({ region: 'us-east-1' }); // ← Change from eu-west-1 to us-east-1

exports.handler = async (event) => {
    console.log('Received Route 53 event from SYSTEST account:', JSON.stringify(event, null, 2));
    
    const message = {
        eventTime: event.time,
        eventName: event.detail?.eventName || 'Unknown',
        eventSource: event.detail?.eventSource || 'Unknown',
        sourceIPAddress: event.detail?.sourceIPAddress || 'Unknown',
        userIdentity: event.detail?.userIdentity || {},
        requestParameters: event.detail?.requestParameters || {},
        responseElements: event.detail?.responseElements || {},
        accountId: event.account || 'Unknown'
    };
    
    const params = {
        TopicArn: process.env.GENERAL_NOTIFICATION_TOPIC,
        Subject: \`SYSTEST Route 53 Change Alert: \${message.eventName}\`,
        Message: JSON.stringify(message, null, 2)
    };
    
    try {
        const command = new PublishCommand(params);
        const result = await snsClient.send(command);
        console.log('Successfully published to SNS:', result.MessageId);
        return { statusCode: 200, body: 'Success' };
    } catch (error) {
        console.error('Failed to publish to SNS:', error);
        throw error;
    }
};
`;

    // Lambda function with inline code (no Docker required)
    const forwarderFunction = new Function(this, 'Route53EventForwarder', {
      functionName: `${project}-${environment}-r53-event-forwarder`,
      runtime: Runtime.NODEJS_20_X,
      handler: 'index.handler',
      timeout: Duration.seconds(60),  // Increased for cross-account calls
      code: Code.fromInline(lambdaCode),
      environment: {
        project, 
        environment, 
        generalNotificationTopic,
        GENERAL_NOTIFICATION_TOPIC: generalNotificationTopic
      }
    });

    // Grant Lambda permission to publish to both SNS topics (like cleanups project)
    forwarderFunction.addToRolePolicy(new PolicyStatement({
      actions: ['sns:Publish'],
      resources: [
        generalNotificationTopic
      ]
    }));

    // EventBridge rule for Route 53 changes (in us-east-1)
    const eventRule = new Rule(this, 'Route53ChangeRule', {
      ruleName: `${project}-${environment}-r53-changes`,
      description: `Detect Route 53 changes in ${environment.toUpperCase()} account`,
      eventPattern: {
        source: ['aws.route53'],
        detailType: ['AWS API Call via CloudTrail'],
        detail: {
          eventSource: ['route53.amazonaws.com'],
          eventName: [
            'ChangeResourceRecordSets',
            'CreateHostedZone',
            'DeleteHostedZone',
            'UpdateHostedZoneComment'
          ]
        }
      }
    });

    // Add Lambda function as target (same region)
    eventRule.addTarget(new LambdaFunction(forwarderFunction));

    // Add tags to all resources in the stack
    Tags.of(this).add('project', project);
    Tags.of(this).add('environment', environment);
    Tags.of(this).add('service', service);
    Tags.of(this).add('version', props.version);
  }
}
