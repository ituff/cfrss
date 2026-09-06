-- Subscription health tracking: consecutive failures and abnormal-flag.
ALTER TABLE subscriptions ADD COLUMN fail_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE subscriptions ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0;
