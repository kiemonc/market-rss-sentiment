import { Publisher } from './publisher.interface';
import { GoogleCloudPublisher } from './google-cloud.publisher';
import { FilePublisher } from './file.publisher';

export type PublisherType = 'gcp' | 'file';

export function createPublisher(type: PublisherType, config: any): Publisher {
  if (type === 'gcp') {
    return new GoogleCloudPublisher(config.gcp.projectId, config.gcp.pubsubTopic);
  } else if (type === 'file') {
    return new FilePublisher(config.filePublisher?.outputDir || './articles');
  } else {
    throw new Error(`Unknown publisher type: ${type}`);
  }
}

export { GoogleCloudPublisher, FilePublisher };
export type { Publisher };
