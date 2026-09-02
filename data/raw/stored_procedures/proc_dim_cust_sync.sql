-- 作业: job_dim_cust_sync  客户维表刷新（全量覆盖）
CREATE PROCEDURE proc_dim_cust_sync()
BEGIN
    DELETE FROM dim_cust;

    INSERT INTO dim_cust (cust_id, cust_name, org_no, cust_level, eff_dt)
    SELECT
        o.cust_id,
        o.cust_name,
        o.org_no,
        o.cust_level,
        DATE_FORMAT(NOW(), '%Y%m%d')
    FROM ods_cust_info o
    WHERE o.etl_dt = (SELECT MAX(etl_dt) FROM ods_cust_info);
END;
