import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";

export interface ReviewJob {
    resumeId: string;
    userId: string;
}

const queueUrl = process.env.REVIEW_QUEUE_URL ?? "";
const client = queueUrl === "" ? null : new SQSClient({});

export const queueConfigured = client !== null;

export async function enqueue(job: ReviewJob): Promise<void> {
    if (client === null) throw new Error("REVIEW_QUEUE_URL is not set.");
    await client.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(job) }));
}
