import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

const sns = new SNSClient({ region: 'eu-west-1' });

const CRITICAL_NOTIFICATION_TOPIC = process.env.CRITICAL_NOTIFICATION_TOPIC!;
const GENERAL_NOTIFICATION_TOPIC = process.env.GENERAL_NOTIFICATION_TOPIC!;

export async function notifyCritical(functionName: string, msgText: string) {
    console.info(`Sending SNS critical message: ${msgText} TO ${CRITICAL_NOTIFICATION_TOPIC}`);
    msgText = "Lambda function '" + functionName + "' critical notification:\n" + msgText;
    try {
        await sns.send(new PublishCommand({
            TopicArn: CRITICAL_NOTIFICATION_TOPIC,
            Subject: `${functionName} CRITICAL NOTIFICATION`,
            Message: msgText
        }));
    } catch(err) {
        console.error(`SNS:Publish failed: ${err}`);
    }
}

export async function notifyGeneral(functionName: string, msgText: string) {
    console.info(`Sending SNS general message: ${msgText} TO ${GENERAL_NOTIFICATION_TOPIC}`);
    msgText = "Lambda function '" + functionName + "' general notification:\n" + msgText;
    try {
        await sns.send(new PublishCommand({
            TopicArn: GENERAL_NOTIFICATION_TOPIC,
            Subject: `${functionName} GENERAL NOTIFICATION`,
            Message: msgText
        }));
    } catch(err) {
        console.error(`SNS:Publish failed: ${err}`);
    }
}