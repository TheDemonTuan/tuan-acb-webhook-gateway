package acb

import "testing"

func TestExtractHistoryForm(t *testing.T) {
	form, err := ExtractHistoryForm(`<form action="/acbib/Request"><input name="dse_operationName" value="ibkacctDetailProc"><input name="dse_processorState" value="fresh-state"><input name="dse_sessionId" value="rotated"></form>`)
	if err != nil {
		t.Fatal(err)
	}
	if form.Action != "/acbib/Request" || form.Fields["dse_sessionId"] != "rotated" {
		t.Fatalf("unexpected form %#v", form)
	}
}

func TestExtractHistoryFormRejectsMissingState(t *testing.T) {
	if _, err := ExtractHistoryForm(`<form action="/acbib/Request"><input name="dse_operationName" value="x"></form>`); err == nil {
		t.Fatal("accepted incomplete state")
	}
}

func TestExtractHistoryFormMultipleFormsAndSelect(t *testing.T) {
	html := `<html><body>
		<form id="headerSearch" action="/search"><input name="q" value="test"></form>
		<form id="mainAccount" action="/acbib/Request">
			<input name="dse_operationName" value="ibkacctDetailProc">
			<input name="dse_processorState" value="accountState">
			<select name="AccountNbr">
				<option value="11111111">Acc 1</option>
				<option value="40478827" selected>Acc 2 (Primary)</option>
			</select>
			<input name="FromDate" value="01/08/2026">
			<input name="ToDate" value="11/09/2026">
		</form>
		<form id="logoutForm" action="/logout"><button>Thoát</button></form>
	</body></html>`

	form, err := ExtractHistoryForm(html)
	if err != nil {
		t.Fatalf("ExtractHistoryForm failed: %v", err)
	}
	if form.Action != "/acbib/Request" {
		t.Fatalf("expected action /acbib/Request, got %q", form.Action)
	}
	if form.Fields["AccountNbr"] != "40478827" {
		t.Fatalf("expected AccountNbr 40478827, got %q", form.Fields["AccountNbr"])
	}
	if form.Fields["q"] != "" {
		t.Fatalf("expected q to be isolated, but got %q", form.Fields["q"])
	}
}
