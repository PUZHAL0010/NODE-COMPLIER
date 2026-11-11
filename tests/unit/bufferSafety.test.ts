import { BoundedOutputCollector } from '../../server/utils/bufferSafety';

describe('BoundedOutputCollector', () => {
  it('appends and returns strings within max limit', () => {
    const collector = new BoundedOutputCollector(1024);
    collector.append('Hello World\n');
    collector.append('Second line');

    expect(collector.getBytesWritten()).toBe(Buffer.byteLength('Hello World\nSecond line'));
    expect(collector.getIsTruncated()).toBe(false);
    expect(collector.toString()).toBe('Hello World\nSecond line');
  });

  it('clamps output and marks truncated when exceeding limit', () => {
    const maxBytes = 100;
    const collector = new BoundedOutputCollector(maxBytes);

    const oversizedString = 'A'.repeat(200);
    collector.append(oversizedString);

    expect(collector.getIsTruncated()).toBe(true);
    expect(collector.getBytesWritten()).toBe(maxBytes);
    expect(collector.toString()).toContain('Output exceeded');
  });
});
