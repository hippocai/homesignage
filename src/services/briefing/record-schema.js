// Existing conversation actions are the provenance for records created before ownership was indexed.
module.exports = async function installRecordControls(db) {
  const installed = await db.one("SELECT 1 FROM sqlite_master WHERE type='table' AND name='pig_record_owner'");
  const backfill = installed ? '' : `
    INSERT OR IGNORE INTO pig_record_owner(id,kind,scope)
      SELECT a.value->>'$.id',a.value->>'$.type',c.scope FROM pig_conversation c, json_each(c.actions) a
      WHERE (a.value->>'$.type'='reminder' AND EXISTS(SELECT 1 FROM timed_reminders r WHERE r.id=a.value->>'$.id' AND r.created_by='pig:'||c.scope))
         OR (a.value->>'$.type'='info' AND EXISTS(SELECT 1 FROM info_items i WHERE i.id=a.value->>'$.id')); `;
  await db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS pig_record_owner(id TEXT PRIMARY KEY,kind TEXT NOT NULL,scope TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1);
    CREATE INDEX IF NOT EXISTS pig_owned_scope ON pig_record_owner(scope,kind);
    ${backfill}
    CREATE TRIGGER IF NOT EXISTS pig_reminder_changed AFTER UPDATE ON timed_reminders BEGIN
      UPDATE pig_record_owner SET revision=revision+1 WHERE id=OLD.id AND kind='reminder';
    END;
    CREATE TRIGGER IF NOT EXISTS pig_info_changed AFTER UPDATE ON info_items BEGIN
      UPDATE pig_record_owner SET revision=revision+1 WHERE id=OLD.id AND kind='info';
    END;
    CREATE TRIGGER IF NOT EXISTS pig_reminder_deleted AFTER DELETE ON timed_reminders BEGIN
      DELETE FROM pig_record_owner WHERE id=OLD.id AND kind='reminder';
    END;
    CREATE TRIGGER IF NOT EXISTS pig_info_deleted AFTER DELETE ON info_items BEGIN
      DELETE FROM pig_record_owner WHERE id=OLD.id AND kind='info';
    END;
    DROP TRIGGER IF EXISTS pig_control;
    CREATE TRIGGER pig_control AFTER INSERT ON pig_conversation WHEN NEW.actions!='[]' BEGIN
      SELECT RAISE(ABORT,'pig_record_conflict') FROM json_each(NEW.actions) a
        WHERE a.value->>'$.op' IN ('update','cancel') AND NOT EXISTS(
          SELECT 1 FROM pig_record_owner WHERE id=a.value->>'$.id' AND scope=NEW.scope
            AND kind=a.value->>'$.type' AND revision=a.value->>'$.revision');
      INSERT INTO info_items(id,type,text,start_time,end_time)
        SELECT value->>'$.id','info',value->>'$.text',value->>'$.start',value->>'$.end'
        FROM json_each(NEW.actions) WHERE value->>'$.type'='info' AND coalesce(value->>'$.op','create')='create';
      INSERT INTO timed_reminders(id,name,device_ids,start_date,start_time,end_time,repeat,content,created_by)
        SELECT value->>'$.id',value->>'$.text',value->>'$.targets',substr(value->>'$.start',1,10),substr(value->>'$.start',12,5),
          substr(value->>'$.end',12,5),'none',json_object('text',value->>'$.text'),'pig:'||NEW.scope
        FROM json_each(NEW.actions) WHERE value->>'$.type'='reminder' AND coalesce(value->>'$.op','create')='create';
      INSERT INTO pig_record_owner(id,kind,scope)
        SELECT value->>'$.id',value->>'$.type',NEW.scope FROM json_each(NEW.actions) WHERE coalesce(value->>'$.op','create')='create';
      UPDATE info_items SET text=a.value->>'$.text',start_time=a.value->>'$.start',end_time=a.value->>'$.end',updated_at=CURRENT_TIMESTAMP
        FROM json_each(NEW.actions) a WHERE a.value->>'$.op'='update' AND a.value->>'$.type'='info' AND info_items.id=a.value->>'$.id';
      UPDATE timed_reminders SET name=CASE WHEN name=json_extract(content,'$.text') THEN a.value->>'$.text' ELSE name END,
        content=json_set(content,'$.text',a.value->>'$.text'), start_date=substr(a.value->>'$.start',1,10),
        start_time=substr(a.value->>'$.start',12,5),end_time=substr(a.value->>'$.end',12,5),updated_at=CURRENT_TIMESTAMP
        FROM json_each(NEW.actions) a WHERE a.value->>'$.op'='update' AND a.value->>'$.type'='reminder' AND timed_reminders.id=a.value->>'$.id';
      DELETE FROM info_items WHERE id IN (SELECT value->>'$.id' FROM json_each(NEW.actions) WHERE value->>'$.op'='cancel' AND value->>'$.type'='info');
      DELETE FROM timed_reminders WHERE id IN (SELECT value->>'$.id' FROM json_each(NEW.actions) WHERE value->>'$.op'='cancel' AND value->>'$.type'='reminder');
    END; COMMIT;`);
};
