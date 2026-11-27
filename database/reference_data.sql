-- Public reference data and migration versions only. No accounts or posts.
SET search_path TO public;

INSERT INTO public.faculties (faculty_id, name, short_name) VALUES
(1, 'Школа информационных технологий и инженерии', 'SITE'),
(2, 'Бизнес-школа', 'BS'),
(3, 'Школа прикладной математики', 'SAM'),
(4, 'Школа энергетики и нефтегазовой индустрии', 'SEOGI'),
(5, 'Международная школа экономики', 'ISE'),
(6, 'Школа химической инженерии', 'SCE');

SELECT pg_catalog.setval(pg_get_serial_sequence('public.faculties', 'faculty_id'), (SELECT max(faculty_id) FROM public.faculties), true);

INSERT INTO public.campus_migrations (version) VALUES (1), (2), (3), (4), (5), (6), (7), (8), (9), (10), (11);
