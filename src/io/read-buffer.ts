export interface ReadBufferPool {
  borrow(size: number): Uint8Array;
  grow(previous: Uint8Array, size: number): Uint8Array;
  release(): void;
}
export class BoundedReadBuffer implements ReadBufferPool {
  private buffer: Uint8Array | undefined;
  private loan: Uint8Array | undefined;
  private allocated = 0;
  get allocatedBytes(): number {
    return this.allocated;
  }
  private capacity(size: number): Uint8Array {
    if (!Number.isSafeInteger(size) || size < 1 || size > 1048577)
      throw new RangeError("Invalid read capacity");
    if (!this.buffer || this.buffer.length < size) {
      this.buffer = new Uint8Array(size);
      this.allocated += size;
    }
    return this.buffer.subarray(0, size);
  }
  borrow(size: number): Uint8Array {
    if (this.loan) throw new Error("Read buffer already borrowed");
    return (this.loan = this.capacity(size));
  }
  grow(previous: Uint8Array, size: number): Uint8Array {
    if (previous !== this.loan || size <= previous.length)
      throw new Error("Invalid read buffer growth");
    const expanded = this.capacity(size);
    expanded.set(previous);
    if (expanded.buffer !== previous.buffer) previous.fill(0);
    return (this.loan = expanded);
  }
  release(): void {
    this.loan?.fill(0);
    this.loan = undefined;
  }
}
