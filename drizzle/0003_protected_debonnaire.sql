-- Promote only the one exact, active Debonnaire account. The guard deliberately
-- aborts the whole D1 migration if the account is missing, ambiguous, or a
-- different owner already exists.
CREATE TABLE `monfrench_owner_promotion_guard_20260714` (
	`ok` integer NOT NULL CHECK (`ok` = 1)
);--> statement-breakpoint
INSERT INTO `monfrench_owner_promotion_guard_20260714` (`ok`)
SELECT CASE WHEN
	(SELECT COUNT(*) FROM `users` WHERE `active`=1 AND lower(`username`)='debonnaire' AND `role` IN ('teacher','owner'))=1
	AND (SELECT COUNT(*) FROM `users` WHERE `role`='owner' AND lower(`username`)<>'debonnaire')=0
	THEN 1 ELSE 0 END;--> statement-breakpoint
UPDATE `users`
SET `role`='owner',`updated_at`=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE `id`=(
	SELECT `id` FROM `users`
	WHERE `active`=1 AND lower(`username`)='debonnaire' AND `role` IN ('teacher','owner')
	ORDER BY `created_at`,`id`
	LIMIT 1
);--> statement-breakpoint
INSERT INTO `audit_events` (`id`,`actor_id`,`action`,`entity_type`,`entity_id`,`details_json`,`created_at`)
SELECT lower(hex(randomblob(16))),NULL,'promote_owner','teacher',`id`,'{"source":"migration-0003"}',strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM `users` WHERE `role`='owner' AND lower(`username`)='debonnaire';--> statement-breakpoint
DROP TABLE `monfrench_owner_promotion_guard_20260714`;
