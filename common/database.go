package common

// DatabaseType is the logical database engine used by the main or log store.
// The fork historically exposed boolean flags; keep those flags as the
// source of truth while providing the enum-shaped API used by newer modules.
type DatabaseType string

const (
	DatabaseTypeMySQL      = "mysql"
	DatabaseTypeSQLite     = "sqlite"
	DatabaseTypePostgreSQL = "postgres"
	DatabaseTypeClickHouse = "clickhouse"
)

var UsingSQLite = false
var UsingPostgreSQL = false
var LogSqlType = DatabaseTypeSQLite // Default to SQLite for logging SQL queries
var UsingMySQL = false
var UsingClickHouse = false

func MainDatabaseType() DatabaseType {
	switch {
	case UsingPostgreSQL:
		return DatabaseType(DatabaseTypePostgreSQL)
	case UsingMySQL:
		return DatabaseType(DatabaseTypeMySQL)
	default:
		return DatabaseType(DatabaseTypeSQLite)
	}
}

func LogDatabaseType() DatabaseType {
	if UsingClickHouse {
		return DatabaseType(DatabaseTypeClickHouse)
	}
	return DatabaseType(LogSqlType)
}

func SetMainDatabaseType(databaseType DatabaseType) {
	UsingSQLite = databaseType == DatabaseType(DatabaseTypeSQLite)
	UsingMySQL = databaseType == DatabaseType(DatabaseTypeMySQL)
	UsingPostgreSQL = databaseType == DatabaseType(DatabaseTypePostgreSQL)
}

func SetLogDatabaseType(databaseType DatabaseType) {
	UsingClickHouse = databaseType == DatabaseType(DatabaseTypeClickHouse)
	LogSqlType = string(databaseType)
}

func SetDatabaseTypes(mainType, logType DatabaseType) {
	SetMainDatabaseType(mainType)
	SetLogDatabaseType(logType)
}

func UsingMainDatabase(databaseType DatabaseType) bool {
	return MainDatabaseType() == databaseType
}

func UsingLogDatabase(databaseType DatabaseType) bool {
	return LogDatabaseType() == databaseType
}

var SQLitePath = "one-api.db?_busy_timeout=30000"
