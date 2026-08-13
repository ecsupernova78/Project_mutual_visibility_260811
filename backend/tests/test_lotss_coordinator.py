from __future__ import annotations

import asyncio

import pytest

from app.lotss_dr3 import (
    MAX_CACHE_ENTRIES,
    CatalogQueryCoordinator,
    LofarCatalogBusy,
    LofarCatalogError,
    LofarSearch,
    _configured_cache_ttl,
    _configured_max_concurrent_jobs,
)
from app.models import LofarSearchResponse


def _search(prefix: str | None = None) -> LofarSearch:
    return LofarSearch(source_prefix=prefix, sort_by="total_flux", sort_direction="desc", limit=10)


def _response(search: LofarSearch) -> LofarSearchResponse:
    return LofarSearchResponse(
        sort_by=search.sort_by,
        sort_direction=search.sort_direction,
        limit=search.limit,
        source_prefix=search.source_prefix,
        result_count=0,
        sources=[],
    )


@pytest.mark.parametrize(
    ("raw_jobs", "expected_jobs"),
    [("bad", 2), ("0", 1), ("99", 4)],
)
def test_concurrency_configuration_falls_back_or_clamps(
    monkeypatch: pytest.MonkeyPatch,
    raw_jobs: str,
    expected_jobs: int,
) -> None:
    monkeypatch.setenv("CATALOG_MAX_CONCURRENT_JOBS", raw_jobs)
    assert _configured_max_concurrent_jobs() == expected_jobs


@pytest.mark.parametrize(("raw_ttl", "expected_ttl"), [("bad", 300.0), ("-1", 0.0), ("9999", 3600.0)])
def test_cache_ttl_configuration_falls_back_or_clamps(
    monkeypatch: pytest.MonkeyPatch,
    raw_ttl: str,
    expected_ttl: float,
) -> None:
    monkeypatch.setenv("CATALOG_CACHE_TTL_SECONDS", raw_ttl)
    assert _configured_cache_ttl() == expected_ttl


def test_same_concurrent_query_uses_one_upstream_job_and_returns_copies() -> None:
    async def scenario() -> None:
        call_count = 0
        started = asyncio.Event()
        release = asyncio.Event()

        async def runner(search: LofarSearch) -> LofarSearchResponse:
            nonlocal call_count
            call_count += 1
            started.set()
            await release.wait()
            return _response(search)

        coordinator = CatalogQueryCoordinator(runner)
        first = asyncio.create_task(coordinator.search(_search()))
        await started.wait()
        second = asyncio.create_task(coordinator.search(_search()))
        await asyncio.sleep(0)
        release.set()
        first_result, second_result = await asyncio.gather(first, second)

        assert call_count == 1
        assert first_result == second_result
        assert first_result is not second_result

    asyncio.run(scenario())


def test_success_cache_hits_until_ttl_then_expires(monkeypatch: pytest.MonkeyPatch) -> None:
    now = [100.0]
    monkeypatch.setenv("CATALOG_CACHE_TTL_SECONDS", "300")
    monkeypatch.setattr("app.lotss_dr3._monotonic", lambda: now[0])

    async def scenario() -> None:
        call_count = 0

        async def runner(search: LofarSearch) -> LofarSearchResponse:
            nonlocal call_count
            call_count += 1
            return _response(search)

        coordinator = CatalogQueryCoordinator(runner)
        first = await coordinator.search(_search())
        now[0] = 399.0
        cached = await coordinator.search(_search())
        assert call_count == 1
        assert cached == first
        assert cached is not first

        now[0] = 400.0
        await coordinator.search(_search())
        assert call_count == 2

    asyncio.run(scenario())


def test_unique_query_limit_is_immediate_but_same_query_still_joins(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CATALOG_MAX_CONCURRENT_JOBS", "1")

    async def scenario() -> None:
        call_count = 0
        started = asyncio.Event()
        release = asyncio.Event()

        async def runner(search: LofarSearch) -> LofarSearchResponse:
            nonlocal call_count
            call_count += 1
            started.set()
            await release.wait()
            return _response(search)

        coordinator = CatalogQueryCoordinator(runner)
        first = asyncio.create_task(coordinator.search(_search("ILTJ1")))
        await started.wait()
        joined = asyncio.create_task(coordinator.search(_search("ILTJ1")))
        with pytest.raises(LofarCatalogBusy):
            await coordinator.search(_search("ILTJ2"))
        release.set()
        await asyncio.gather(first, joined)
        assert call_count == 1

    asyncio.run(scenario())


def test_failed_query_is_not_cached_and_can_be_retried() -> None:
    async def scenario() -> None:
        call_count = 0

        async def runner(search: LofarSearch) -> LofarSearchResponse:
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise LofarCatalogError("temporary failure")
            return _response(search)

        coordinator = CatalogQueryCoordinator(runner)
        with pytest.raises(LofarCatalogError):
            await coordinator.search(_search())
        response = await coordinator.search(_search())
        assert response.result_count == 0
        assert call_count == 2

    asyncio.run(scenario())


def test_degraded_enrichment_response_is_not_cached() -> None:
    async def scenario() -> None:
        call_count = 0

        async def runner(search: LofarSearch) -> LofarSearchResponse:
            nonlocal call_count
            call_count += 1
            return LofarSearchResponse(
                sort_by=search.sort_by,
                sort_direction=search.sort_direction,
                limit=search.limit,
                source_prefix=search.source_prefix,
                result_count=0,
                sources=[],
                enrichment_status="unavailable",
                enrichment_warning="temporary failure",
            )

        coordinator = CatalogQueryCoordinator(runner)
        await coordinator.search(_search())
        await coordinator.search(_search())
        assert call_count == 2

    asyncio.run(scenario())


def test_cancelling_one_waiter_does_not_cancel_shared_query() -> None:
    async def scenario() -> None:
        call_count = 0
        runner_cancelled = False
        started = asyncio.Event()
        release = asyncio.Event()

        async def runner(search: LofarSearch) -> LofarSearchResponse:
            nonlocal call_count, runner_cancelled
            call_count += 1
            started.set()
            try:
                await release.wait()
            except asyncio.CancelledError:
                runner_cancelled = True
                raise
            return _response(search)

        coordinator = CatalogQueryCoordinator(runner)
        cancelled_waiter = asyncio.create_task(coordinator.search(_search()))
        await started.wait()
        remaining_waiter = asyncio.create_task(coordinator.search(_search()))
        await asyncio.sleep(0)
        cancelled_waiter.cancel()
        with pytest.raises(asyncio.CancelledError):
            await cancelled_waiter
        release.set()
        result = await remaining_waiter

        assert result.result_count == 0
        assert call_count == 1
        assert runner_cancelled is False

    asyncio.run(scenario())


def test_all_cancelled_waiters_do_not_leave_unobserved_shared_failure() -> None:
    async def scenario() -> None:
        started = asyncio.Event()
        fail = asyncio.Event()

        async def runner(search: LofarSearch) -> LofarSearchResponse:
            started.set()
            await fail.wait()
            raise LofarCatalogError("orphaned failure")

        coordinator = CatalogQueryCoordinator(runner)
        waiter = asyncio.create_task(coordinator.search(_search()))
        await started.wait()
        waiter.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiter
        fail.set()
        await asyncio.sleep(0)
        await asyncio.sleep(0)

    asyncio.run(scenario())


def test_cache_is_bounded_and_prunes_expired_unrelated_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    now = [100.0]
    monkeypatch.setenv("CATALOG_CACHE_TTL_SECONDS", "300")
    monkeypatch.setattr("app.lotss_dr3._monotonic", lambda: now[0])

    async def scenario() -> None:
        async def runner(search: LofarSearch) -> LofarSearchResponse:
            return _response(search)

        coordinator = CatalogQueryCoordinator(runner)
        for index in range(MAX_CACHE_ENTRIES + 5):
            await coordinator.search(_search(f"ILTJ{index}"))
        assert len(coordinator._cache) == MAX_CACHE_ENTRIES

        now[0] = 401.0
        await coordinator.search(_search("FRESH"))
        assert list(coordinator._cache) == [_search("FRESH")]

    asyncio.run(scenario())
