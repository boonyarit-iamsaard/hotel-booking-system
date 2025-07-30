import { randomUUID } from 'node:crypto'

export abstract class Entity<T> {
  protected constructor(protected props: T, public readonly id: string = randomUUID()) {
  }
}
