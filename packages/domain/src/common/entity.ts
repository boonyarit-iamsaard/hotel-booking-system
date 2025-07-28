import { randomUUID } from 'node:crypto'

export abstract class Entity<T> {
  constructor(protected props: T, public readonly id: string = randomUUID()) {
  }
}
