import time
from app.circuit import CircuitBreaker, CircuitState

def test_circuit_breaker_transitions():
    cb = CircuitBreaker(failure_threshold=3, reset_timeout=0.2)
    assert cb.state == CircuitState.CLOSED
    assert cb.can_attempt() is True

    # 1st failure
    cb.record_failure()
    assert cb.state == CircuitState.CLOSED
    assert cb.can_attempt() is True

    # 2nd failure
    cb.record_failure()
    assert cb.state == CircuitState.CLOSED
    assert cb.can_attempt() is True

    # 3rd failure -> OPEN
    cb.record_failure()
    assert cb.state == CircuitState.OPEN
    assert cb.can_attempt() is False

    # Wait for reset timeout
    time.sleep(0.25)
    assert cb.can_attempt() is True
    assert cb.state == CircuitState.HALF_OPEN

    # Success records -> CLOSED
    cb.record_success()
    assert cb.state == CircuitState.CLOSED
    assert cb.failure_count == 0
