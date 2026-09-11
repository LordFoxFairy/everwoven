import {v7} from 'uuid';
import {isBusinessId} from '../contracts/primitives.js';

export type IdFactory = {next: () => string};
export type Clock = {now: () => Date};
export type RuntimeServices = {ids: IdFactory; clock: Clock};
export const systemServices: RuntimeServices = {ids: {next: () => v7()}, clock: {now: () => new Date()}};
export function nextId(services: RuntimeServices): string {
  const id = services.ids.next(); if (!isBusinessId(id)) throw new Error('ID_FACTORY_INVALID'); return id;
}
export function currentTime(services: RuntimeServices, notBefore?: Date): Date {
  const now = services.clock.now();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('CLOCK_INVALID');
  return new Date(Math.max(now.getTime(), notBefore?.getTime() ?? -Infinity));
}
