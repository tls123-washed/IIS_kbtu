CREATE TABLE public.event_organizers (
    user_id INT PRIMARY KEY REFERENCES public.users(user_id) ON DELETE CASCADE
);

-- Старые мероприятия из pgAdmin могут оставаться без указанного автора.
ALTER TABLE public.events
    ADD COLUMN organizer_id INT REFERENCES public.users(user_id) ON DELETE SET NULL;
