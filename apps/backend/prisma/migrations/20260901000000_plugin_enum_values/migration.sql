-- PostgreSQL requires newly added enum labels to commit before later migrations may use them.
ALTER TYPE "ResourceKind" ADD VALUE IF NOT EXISTS 'Plugin';
ALTER TYPE "ResourceKind" ADD VALUE IF NOT EXISTS 'PluginPack';
ALTER TYPE "ExecutionRunState" ADD VALUE IF NOT EXISTS 'paused_plugin';
