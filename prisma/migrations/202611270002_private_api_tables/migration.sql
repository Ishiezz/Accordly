-- Express authenticates project members; browser database API roles have no table access.
ALTER TABLE public."User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Project" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Agreement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Deliverable" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ChangeRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Proposal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Comment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Invitation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Attachment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ProjectCheckIn" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."_prisma_migrations" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public."User" FROM anon;
    REVOKE ALL ON TABLE public."Session" FROM anon;
    REVOKE ALL ON TABLE public."Project" FROM anon;
    REVOKE ALL ON TABLE public."Agreement" FROM anon;
    REVOKE ALL ON TABLE public."Deliverable" FROM anon;
    REVOKE ALL ON TABLE public."ChangeRequest" FROM anon;
    REVOKE ALL ON TABLE public."Proposal" FROM anon;
    REVOKE ALL ON TABLE public."Comment" FROM anon;
    REVOKE ALL ON TABLE public."Invitation" FROM anon;
    REVOKE ALL ON TABLE public."Event" FROM anon;
    REVOKE ALL ON TABLE public."Attachment" FROM anon;
    REVOKE ALL ON TABLE public."Notification" FROM anon;
    REVOKE ALL ON TABLE public."ProjectCheckIn" FROM anon;
    REVOKE ALL ON TABLE public."_prisma_migrations" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public."User" FROM authenticated;
    REVOKE ALL ON TABLE public."Session" FROM authenticated;
    REVOKE ALL ON TABLE public."Project" FROM authenticated;
    REVOKE ALL ON TABLE public."Agreement" FROM authenticated;
    REVOKE ALL ON TABLE public."Deliverable" FROM authenticated;
    REVOKE ALL ON TABLE public."ChangeRequest" FROM authenticated;
    REVOKE ALL ON TABLE public."Proposal" FROM authenticated;
    REVOKE ALL ON TABLE public."Comment" FROM authenticated;
    REVOKE ALL ON TABLE public."Invitation" FROM authenticated;
    REVOKE ALL ON TABLE public."Event" FROM authenticated;
    REVOKE ALL ON TABLE public."Attachment" FROM authenticated;
    REVOKE ALL ON TABLE public."Notification" FROM authenticated;
    REVOKE ALL ON TABLE public."ProjectCheckIn" FROM authenticated;
    REVOKE ALL ON TABLE public."_prisma_migrations" FROM authenticated;
  END IF;
END $$;
