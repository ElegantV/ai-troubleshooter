-- ============================================================
-- 模拟数据：客户资产日报数仓 DDL（银行数据仓库，分 ODS/DIM/DWD/DWS/ADS 五层）
-- 仅供原型演示，数据均为虚构
-- ============================================================

CREATE TABLE ods_txnl_detail (
    txnl_id      VARCHAR(32)   NOT NULL COMMENT '交易流水号',
    acct_no      VARCHAR(32)   COMMENT '账号',
    txnl_type    VARCHAR(8)    COMMENT '交易类型 01转账 02存款 03取款',
    txnl_amt     DECIMAL(18,2) COMMENT '交易金额',
    txnl_dt      VARCHAR(8)    COMMENT '交易日期 yyyyMMdd',
    opp_acct_no  VARCHAR(32)   COMMENT '对方账号',
    etl_dt       VARCHAR(8)    COMMENT '数据日期分区 yyyyMMdd',
    PRIMARY KEY (txnl_id, etl_dt)
) COMMENT='ODS-交易明细贴源表（源系统FTP文件加载）';

CREATE TABLE ods_acct_bal (
    acct_no      VARCHAR(32)   NOT NULL COMMENT '账号',
    bal_amt      DECIMAL(18,2) COMMENT '账户余额',
    bal_dt       VARCHAR(8)    COMMENT '余额日期 yyyyMMdd',
    etl_dt       VARCHAR(8)    COMMENT '数据日期分区 yyyyMMdd',
    PRIMARY KEY (acct_no, etl_dt)
) COMMENT='ODS-账户余额贴源表（源系统FTP文件加载）';

CREATE TABLE ods_cust_info (
    cust_id      VARCHAR(20)   NOT NULL COMMENT '客户号',
    cust_name    VARCHAR(64)   COMMENT '客户名称',
    cert_no      VARCHAR(32)   COMMENT '证件号码',
    org_no       VARCHAR(12)   COMMENT '归属机构号',
    cust_level   VARCHAR(2)    COMMENT '客户等级 01普通 02贵宾 03私行',
    etl_dt       VARCHAR(8)    COMMENT '数据日期分区 yyyyMMdd',
    PRIMARY KEY (cust_id, etl_dt)
) COMMENT='ODS-客户信息贴源表';

CREATE TABLE dim_cust (
    cust_id      VARCHAR(20)   NOT NULL COMMENT '客户号',
    cust_name    VARCHAR(64)   COMMENT '客户名称',
    org_no       VARCHAR(12)   COMMENT '归属机构号',
    cust_level   VARCHAR(2)    COMMENT '客户等级',
    eff_dt       VARCHAR(8)    COMMENT '生效日期',
    PRIMARY KEY (cust_id)
) COMMENT='DIM-客户维表（拉链表）';

CREATE TABLE dim_org (
    org_no       VARCHAR(12)   NOT NULL COMMENT '机构号',
    org_name     VARCHAR(64)   COMMENT '机构名称',
    org_level    VARCHAR(2)    COMMENT '机构级别 01总行 02分行 03支行',
    parent_org   VARCHAR(12)   COMMENT '上级机构号',
    PRIMARY KEY (org_no)
) COMMENT='DIM-机构维表';

CREATE TABLE dwd_txnl_detail_d (
    txnl_id      VARCHAR(32)   NOT NULL COMMENT '交易流水号',
    cust_id      VARCHAR(20)   COMMENT '客户号（关联客户维表补全）',
    acct_no      VARCHAR(32)   COMMENT '账号',
    txnl_type    VARCHAR(8)    COMMENT '交易类型',
    txnl_amt     DECIMAL(18,2) COMMENT '交易金额',
    txnl_dt      VARCHAR(8)    COMMENT '交易日期',
    data_dt      VARCHAR(8)    COMMENT '数据日期分区 yyyyMMdd',
    PRIMARY KEY (txnl_id, data_dt)
) COMMENT='DWD-交易明细日表（清洗后）';

CREATE TABLE dws_cust_asset_d (
    cust_id      VARCHAR(20)   NOT NULL COMMENT '客户号',
    org_no       VARCHAR(12)   COMMENT '归属机构号',
    cust_level   VARCHAR(2)    COMMENT '客户等级',
    txnl_cnt     DECIMAL(10,0) COMMENT '当日交易笔数',
    txnl_amt_sum DECIMAL(20,2) COMMENT '当日交易金额合计',
    bal_amt_sum  DECIMAL(20,2) COMMENT '客户资产余额合计',
    data_dt      VARCHAR(8)    COMMENT '数据日期分区 yyyyMMdd',
    PRIMARY KEY (cust_id, data_dt)
) COMMENT='DWS-客户资产日汇总表';

CREATE TABLE ads_cust_asset_rpt (
    org_no        VARCHAR(12)  COMMENT '机构号',
    cust_level    VARCHAR(2)   COMMENT '客户等级',
    cust_cnt      DECIMAL(10,0) COMMENT '客户数',
    asset_amt     DECIMAL(20,2) COMMENT '资产规模',
    txnl_amt      DECIMAL(20,2) COMMENT '交易规模',
    data_dt       VARCHAR(8)   COMMENT '数据日期分区 yyyyMMdd',
    PRIMARY KEY (org_no, cust_level, data_dt)
) COMMENT='ADS-客户资产日报表（对客发布）';
