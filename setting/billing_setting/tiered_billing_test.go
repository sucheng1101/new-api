package billing_setting

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestSmokeTestExprRejectsUnknownBillingVariable(t *testing.T) {
	require.NoError(t, SmokeTestExpr(`tier("base", p * 3 + cc1h * 6)`))
	require.ErrorContains(t, SmokeTestExpr(`tier("base", p * 3 + cc12h * 6)`), "unknown billing variable(s): cc12h")
}
