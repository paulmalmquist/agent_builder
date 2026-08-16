import { AppError } from '../errors.js';
import { currentRequestContext } from '../request-context.js';

export function requireHumanActor(): string {
  const context = currentRequestContext();
  if (context.actor.authentication === 'system' || context.actor.id.startsWith('system:')) {
    throw new AppError(
      403,
      'HUMAN_APPROVAL_REQUIRED',
      'This governance action requires an authenticated human actor',
    );
  }
  return context.actor.id;
}
