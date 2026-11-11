-- Сброс отдельной учебной базы в PGlite перед загрузкой демоданных.
DROP TABLE IF EXISTS post_hashtags, hashtags, likes, follows, attachments,
                     posts, community_members, communities,
                     moderators, mentors, scholarship_holders,
                     teachers, students, users, faculties CASCADE;
