-- rls_auto_enable() is a platform event-trigger helper; it must not be callable through /rest/v1/rpc.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
