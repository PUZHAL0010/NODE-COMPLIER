/**
 * Buffer Safety & Bounded Stream Collector
 * Ensures no unbounded buffer concatenation in memory to protect against DoS attacks.
 */

export class BoundedOutputCollector {
  private chunks: Buffer[] = [];
  private totalBytes = 0;
  private isTruncated = false;
  private readonly maxBytes: number;

  constructor(maxBytes: number) {
    this.maxBytes = maxBytes;
  }

  /**
   * Append a raw string or buffer chunk, clamping if it exceeds the configured maximum.
   */
  public append(chunk: string | Buffer): void {
    if (this.isTruncated) {
      return;
    }

    const bufferChunk = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk, 'utf8');

    const availableSpace = this.maxBytes - this.totalBytes;

    if (bufferChunk.length <= availableSpace) {
      this.chunks.push(bufferChunk);
      this.totalBytes += bufferChunk.length;
    } else {
      if (availableSpace > 0) {
        this.chunks.push(bufferChunk.subarray(0, availableSpace));
        this.totalBytes += availableSpace;
      }
      this.isTruncated = true;
      const truncationNotice = Buffer.from(
        `\n[WARN] Output exceeded ${Math.round(this.maxBytes / 1024)} KB limit and was truncated.\n`,
        'utf8'
      );
      this.chunks.push(truncationNotice);
    }
  }

  public getBytesWritten(): number {
    return this.totalBytes;
  }

  public getIsTruncated(): boolean {
    return this.isTruncated;
  }

  public toString(encoding: BufferEncoding = 'utf8'): string {
    return Buffer.concat(this.chunks).toString(encoding);
  }

  public reset(): void {
    this.chunks = [];
    this.totalBytes = 0;
    this.isTruncated = false;
  }
}
