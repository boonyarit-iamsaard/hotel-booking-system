export abstract class ValueObject<T> {
  constructor(protected readonly props: T) {}
}
