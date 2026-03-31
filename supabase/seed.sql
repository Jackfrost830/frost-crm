insert into public.products (code, name, product_family, description, default_arr)
values
  ('ASSESS', 'Assessment Services', 'Services', 'Security assessment engagements', 12000),
  ('VENDOR', 'Vendor Risk Program', 'Platform', 'Vendor risk management services', 18000),
  ('POLICY', 'Policy Management', 'Platform', 'Policy and compliance support', 9000)
on conflict (code) do update
set
  name = excluded.name,
  product_family = excluded.product_family,
  description = excluded.description,
  default_arr = excluded.default_arr;
