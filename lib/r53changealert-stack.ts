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

    const project = props.project.toLowerCase();
    const ENVIRONMENT = props.environment.toUpperCase();
    const environment = props.environment.toLowerCase();

    // SNS topic configuration for each environment
    const generalNotificationTopic = ENVIRONMENT === 'PRODVIR' 
      ? `arn:aws:sns:us-east-1:${this.account}:admin-prod-events-general`
      : `arn:aws:sns:us-east-1:${this.account}:MONITORING-SYSTEST-events-general`;

    // Single Lambda function code using environment variables
    const lambdaCode = `
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const snsClient = new SNSClient({ region: 'us-east-1' });

exports.handler = async (event) => {
    const environment = process.env.ENVIRONMENT_NAME || 'Unknown';
    console.log(\`Received Route 53 event from \${environment} account:\`, JSON.stringify(event, null, 2));
    
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
        Subject: \`\${environment} Route 53 Change Alert: \${message.eventName}\`,
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

    // Lambda function with environment-specific variables
    const forwarderFunction = new Function(this, 'Route53EventForwarder', {
      functionName: `${project}-${environment}-r53-event-forwarder`,
      runtime: Runtime.NODEJS_22_X,
      handler: 'index.handler',
      timeout: Duration.seconds(60),
      code: Code.fromInline(lambdaCode),
      environment: {
        project, 
        environment, 
        ENVIRONMENT_NAME: ENVIRONMENT === 'PRODVIR' ? 'MASTER Account' : 'SYSTEST',
        GENERAL_NOTIFICATION_TOPIC: generalNotificationTopic
      }
    });

    // Grant SNS publish permissions
    forwarderFunction.addToRolePolicy(new PolicyStatement({
      actions: ['sns:Publish'],
      resources: [generalNotificationTopic]
    }));

    // EventBridge rule for Route 53 changes
    const eventRule = new Rule(this, 'Route53ChangeRule', {
      ruleName: `${project}-${environment}-r53-changes`,
      description: `Detect Route 53 changes in ${ENVIRONMENT} account`,
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

    // Add Lambda as target
    eventRule.addTarget(new LambdaFunction(forwarderFunction));

    // Add tags
    Tags.of(this).add('project', project);
    Tags.of(this).add('environment', environment);
    Tags.of(this).add('service', props.service);
    Tags.of(this).add('version', props.version);
  }
}
