begin;

create or replace function public.replace_certificate_with_current_data(
  target_certificate_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_certificate public.certificates%rowtype;
  replacement_certificate_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  select certificate.*
  into target_certificate
  from public.certificates as certificate
  where certificate.id = target_certificate_id
  for update;

  if target_certificate.id is null then
    raise exception 'Certificate not found';
  end if;

  if not (
    public.is_platform_admin()
    or public.has_org_role(target_certificate.org_id, array['owner'])
  ) then
    raise exception 'Certificate replacement is not allowed';
  end if;

  if target_certificate.status <> 'valid' then
    raise exception 'Only a valid certificate can be replaced';
  end if;

  perform public.revoke_certificate(
    target_certificate.id,
    'بيانات المتدرب أو التسجيل تغيرت بعد إصدار الشهادة'
  );

  replacement_certificate_id :=
    public.reissue_certificate(target_certificate.id);

  return replacement_certificate_id;
end;
$$;

revoke all on function public.replace_certificate_with_current_data(uuid)
  from public;
revoke all on function public.replace_certificate_with_current_data(uuid)
  from anon;

grant execute
on function public.replace_certificate_with_current_data(uuid)
to authenticated;

commit;
