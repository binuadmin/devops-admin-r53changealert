import { Stack, StackProps, Tags, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Rule } from 'aws-cdk-lib/aws-events';
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

    const project = props.project.toLowerCase();
    const ENVIRONMENT = props.environment.toUpperCase();
    const environment = props.environment.toLowerCase();

    // SNS topic configuration for each environment
    const generalNotificationTopic = ENVIRONMENT === 'PRODVIR' 
      ? `arn:aws:sns:us-east-1:${this.account}:admin-prod-events-general`
      : `arn:aws:sns:us-east-1:${this.account}:MONITORING-SYSTEST-events-general`;

    // Lambda function - references external handler file
    const forwarderFunction = new Function(this, 'Route53EventForwarder', {
      functionName: `${project}-${environment}-r53-event-forwarder`,
      runtime: Runtime.NODEJS_22_X,
      handler: 'route53-handler.handler',  // ← Points to exported handler function
      timeout: Duration.seconds(60),
      code: Code.fromAsset('src'),  // ← Points to src directory
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
