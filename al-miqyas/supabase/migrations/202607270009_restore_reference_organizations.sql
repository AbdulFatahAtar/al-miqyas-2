begin;

insert into public.organizations (
  slug,
  name_ar,
  name_en,
  brand_color,
  status
)
values
  (
    'uqu-medical-college',
    'كلية الطب · جامعة أم القرى',
    'College of Medicine · Umm Al-Qura University',
    '#C9A24B',
    'active'
  ),
  (
    'al-itqan-training-academy',
    'أكاديمية الإتقان للتدريب',
    'Al-Itqan Training Academy',
    '#35C6E6',
    'suspended'
  )
on conflict (slug) do update
set
  name_ar = excluded.name_ar,
  name_en = excluded.name_en,
  brand_color = excluded.brand_color,
  status = excluded.status,
  archived_at = null,
  updated_at = now();

commit;
