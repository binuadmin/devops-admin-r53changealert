import { Stack, StackProps, Tags, Fn } from 'aws-cdk-lib';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';

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

    // Constructed ARNs for cross-region access:
    const generalNotificationTopic = ENVIRONMENT === 'PROD' 
      ? `arn:aws:sns:eu-west-1:${this.account}:${PROJECT}-SYSTEST-events-general` // Use SYSTEST SNS from SYSTEST account
      : `arn:aws:sns:eu-west-1:${this.account}:${PROJECT}-${ENVIRONMENT}-events-general`;

    // Environment-specific Lambda code
    const lambdaCode = ENVIRONMENT === 'PROD' 
      ? `
// This code runs in SYSTEST account but monitors master account
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { STSClient, AssumeRoleCommand } = require('@aws-sdk/client-sts');
const { CloudTrailClient, LookupEventsCommand } = require('@aws-sdk/client-cloudtrail');

const snsClient = new SNSClient({ region: 'eu-west-1' });
const stsClient = new STSClient({ region: 'us-east-1' });

exports.handler = async (event) => {
    console.log('Checking Route 53 events from master account via cross-account role');
    
    // Assume role in master account
    const assumeRoleCommand = new AssumeRoleCommand({
        RoleArn: 'arn:aws:iam::872442554780:role/admin-prod-CrossAccountR53MonitoringRole',
        RoleSessionName: 'R53Monitoring',
        ExternalId: 'R53Monitoring'
    });
    
    try {
        const credentials = await stsClient.send(assumeRoleCommand);
        
        // Create CloudTrail client with master account credentials
        const cloudTrailClient = new CloudTrailClient({
            region: 'us-east-1',
            credentials: {
                accessKeyId: credentials.Credentials.AccessKeyId,
                secretAccessKey: credentials.Credentials.SecretAccessKey,
                sessionToken: credentials.Credentials.SessionToken
            }
        });
        
        // Look up recent Route 53 events from master account
        const lookupCommand = new LookupEventsCommand({
            LookupAttributes: [
                {
                    AttributeKey: 'EventSource',
                    AttributeValue: 'route53.amazonaws.com'
                }
            ],
            StartTime: new Date(Date.now() - 5 * 60 * 1000), // Last 5 minutes
            MaxItems: 10
        });
        
        const events = await cloudTrailClient.send(lookupCommand);
        
        for (const event of events.Events || []) {
            if (['ChangeResourceRecordSets', 'CreateHostedZone', 'DeleteHostedZone', 'UpdateHostedZoneComment'].includes(event.EventName)) {
                const message = {
                    eventTime: event.EventTime,
                    eventName: event.EventName,
                    eventSource: 'route53.amazonaws.com',
                    sourceIPAddress: event.SourceIPAddress,
                    userIdentity: JSON.parse(event.CloudTrailEvent).userIdentity,
                    requestParameters: JSON.parse(event.CloudTrailEvent).requestParameters,
                    responseElements: JSON.parse(event.CloudTrailEvent).responseElements,
                    masterAccountId: '872442554780'
                };
                
                const params = {
                    TopicArn: process.env.GENERAL_NOTIFICATION_TOPIC,
                    Subject: \`Master Account Route 53 Change (from SYSTEST): \${event.EventName}\`,
                    Message: JSON.stringify(message, null, 2)
                };
                
                await snsClient.send(new PublishCommand(params));
                console.log('Published Route 53 change from master account:', event.EventName);
            }
        }
        
        return { statusCode: 200, body: 'Success' };
        
    } catch (error) {
        console.error('Failed to assume role or query CloudTrail:', error);
        throw error;
    }
};
      `
      : `
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const snsClient = new SNSClient({ region: 'eu-west-1' });

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
      timeout: cdk.Duration.seconds(60),  // Increased for cross-account calls
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

    // Add cross-account assume role permission (PROD only)
    if (ENVIRONMENT === 'PROD') {
      forwarderFunction.addToRolePolicy(new PolicyStatement({
        actions: ['sts:AssumeRole'],
        resources: ['arn:aws:iam::872442554780:role/admin-prod-CrossAccountR53MonitoringRole']
      }));
      
      // Add CloudTrail permissions
      forwarderFunction.addToRolePolicy(new PolicyStatement({
        actions: [
          'cloudtrail:LookupEvents'
        ],
        resources: ['*']
      }));
    }

    // EventBridge rule for Route 53 changes (in us-east-1)
    const eventRule = ENVIRONMENT === 'PROD' 
      ? new Rule(this, 'Route53MonitoringSchedule', {
          ruleName: `${project}-${environment}-r53-monitoring-schedule`,
          description: 'Schedule Route 53 monitoring of master account',
          schedule: Schedule.rate(cdk.Duration.minutes(5))
        })
      : new Rule(this, 'Route53ChangeRule', {
          ruleName: `${project}-${environment}-r53-changes`,
          description: 'Detect Route 53 changes',
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
