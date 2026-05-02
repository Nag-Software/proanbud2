const { Client } = require('pg');

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  
  try {
    console.log("Dropping recursive policy...");
    await client.query(`
      DROP POLICY IF EXISTS admins_manage_project_assignments ON public.project_members;
    `);

    // Create a secure function to check manager access bypassing RLS
    await client.query(`
      CREATE OR REPLACE FUNCTION public.is_project_manager(p_project_id UUID)
      RETURNS BOOLEAN AS $$
      BEGIN
        IF public.is_company_admin() THEN
          RETURN true;
        END IF;

        RETURN EXISTS (
          SELECT 1 FROM public.project_members pm
          WHERE pm.project_id = p_project_id
          AND pm.user_id = auth.uid()
          AND pm.access_level = 'manager'
        );
      END;
      $$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
    `);

    console.log("Recreating policy safely using security definer...");
    await client.query(`
      CREATE POLICY admins_manage_project_assignments ON public.project_members FOR ALL
      USING (public.is_project_manager(project_id))
      WITH CHECK (public.is_project_manager(project_id));
    `);
    
    // Fix manage_assigned_projects on projects table which might ALSO have a recursive inline query!
    await client.query(`
      DROP POLICY IF EXISTS manage_assigned_projects ON public.projects;
      
      CREATE OR REPLACE FUNCTION public.can_manage_project(p_project_id UUID)
      RETURNS BOOLEAN AS $$
      BEGIN
        IF public.is_company_admin() THEN
          RETURN true;
        END IF;

        RETURN EXISTS (
          SELECT 1 FROM public.project_members pm
          WHERE pm.project_id = p_project_id
          AND pm.user_id = auth.uid()
          AND pm.access_level IN ('write', 'manager')
        );
      END;
      $$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

      CREATE POLICY manage_assigned_projects ON public.projects FOR UPDATE
      USING (
        company_id = public.get_current_company_id()
        AND public.can_manage_project(id)
      );
    `);

    console.log("Done fixing recursions!");
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run();