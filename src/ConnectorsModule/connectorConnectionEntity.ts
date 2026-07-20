import mongoose, { InferSchemaType, HydratedDocument } from 'mongoose';

const connectorConnectionSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    source: {
      type: String,
      required: true,
      enum: [
        'gmail',
        'slack',
        'github',
        'vscode',
        'chrome',
        'calendar',
        'notion',
        'drive',
        'photos',
        'manual',
      ],
    },
    /** Display label e.g. email / workspace name */
    accountLabel: { type: String, default: '' },
    /** Encrypted JSON blob: { accessToken?, refreshToken?, apiKey?, ... } */
    credentialsEnc: { type: String, default: null },
    enabled: { type: Boolean, default: true },
    lastSyncedAt: { type: Date, default: null },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

connectorConnectionSchema.index({ userId: 1, source: 1 }, { unique: true });

export type ConnectorConnection = InferSchemaType<
  typeof connectorConnectionSchema
>;
export type ConnectorConnectionDocument = HydratedDocument<ConnectorConnection>;

const ConnectorConnectionEntity = mongoose.model(
  'ConnectorConnection',
  connectorConnectionSchema,
);

export default ConnectorConnectionEntity;
