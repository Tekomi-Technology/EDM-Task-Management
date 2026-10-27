/** A message that will never be delivered as it is (bad number, rejected by the gateway); not retried. */
export class PermanentDeliveryError extends Error {
  constructor(
    message: string,
    /** Expo's error code for push, e.g. DeviceNotRegistered. */
    readonly code?: string
  ) {
    super(message);
    this.name = 'PermanentDeliveryError';
  }
}
