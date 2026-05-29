export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      attachments: {
        Row: {
          application_id: string | null
          created_at: string
          file_name: string
          file_type: string | null
          id: string
          mime_type: string | null
          size_bytes: number | null
          storage_path: string
          user_id: string
        }
        Insert: {
          application_id?: string | null
          created_at?: string
          file_name: string
          file_type?: string | null
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path: string
          user_id: string
        }
        Update: {
          application_id?: string | null
          created_at?: string
          file_name?: string
          file_type?: string | null
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attachments_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "job_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          application_id: string | null
          created_at: string
          email: string | null
          id: string
          linkedin_url: string | null
          name: string
          notes: string | null
          phone: string | null
          role: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          application_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          linkedin_url?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          role?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          application_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          linkedin_url?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          role?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "job_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          application_id: string | null
          company_name: string | null
          content_text: string | null
          created_at: string
          customization_notes: string | null
          document_type: Database["public"]["Enums"]["document_type"]
          file_name: string | null
          file_path: string | null
          file_size_bytes: number | null
          id: string
          is_base_version: boolean | null
          mime_type: string | null
          tailored_for: string | null
          title: string
          updated_at: string
          user_id: string
          version: number | null
        }
        Insert: {
          application_id?: string | null
          company_name?: string | null
          content_text?: string | null
          created_at?: string
          customization_notes?: string | null
          document_type: Database["public"]["Enums"]["document_type"]
          file_name?: string | null
          file_path?: string | null
          file_size_bytes?: number | null
          id?: string
          is_base_version?: boolean | null
          mime_type?: string | null
          tailored_for?: string | null
          title: string
          updated_at?: string
          user_id: string
          version?: number | null
        }
        Update: {
          application_id?: string | null
          company_name?: string | null
          content_text?: string | null
          created_at?: string
          customization_notes?: string | null
          document_type?: Database["public"]["Enums"]["document_type"]
          file_name?: string | null
          file_path?: string | null
          file_size_bytes?: number | null
          id?: string
          is_base_version?: boolean | null
          mime_type?: string | null
          tailored_for?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          version?: number | null
        }
        Relationships: []
      }
      email_connections: {
        Row: {
          access_token: string | null
          connected_at: string
          email_address: string
          id: string
          last_error: string | null
          last_sync_at: string | null
          last_synced_internal_date: number | null
          provider: Database["public"]["Enums"]["email_provider"]
          refresh_token: string | null
          scopes_granted: string[] | null
          status: Database["public"]["Enums"]["email_connection_status"]
          token_expires_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token?: string | null
          connected_at?: string
          email_address: string
          id?: string
          last_error?: string | null
          last_sync_at?: string | null
          last_synced_internal_date?: number | null
          provider: Database["public"]["Enums"]["email_provider"]
          refresh_token?: string | null
          scopes_granted?: string[] | null
          status?: Database["public"]["Enums"]["email_connection_status"]
          token_expires_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string | null
          connected_at?: string
          email_address?: string
          id?: string
          last_error?: string | null
          last_sync_at?: string | null
          last_synced_internal_date?: number | null
          provider?: Database["public"]["Enums"]["email_provider"]
          refresh_token?: string | null
          scopes_granted?: string[] | null
          status?: Database["public"]["Enums"]["email_connection_status"]
          token_expires_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      employer_reports: {
        Row: {
          analysis_date: string | null
          branch_country: string | null
          company_domain: string
          company_name: string
          created_at: string
          dimensions: Json
          employee_count: number | null
          employee_count_as_of: string | null
          employee_count_source: string | null
          id: string
          industry_nace: string | null
          ingest_ip_hash: string | null
          language: string
          overall_score: number | null
          parent_country: string | null
          report_id: string
          revenue_bucket: string | null
          schema_version: string
          scope_deviation: boolean | null
          scored_dimensions: number | null
          search_count: number | null
          source_count: number | null
          submitted_at: string
          tier: string
          total_dimensions: number | null
        }
        Insert: {
          analysis_date?: string | null
          branch_country?: string | null
          company_domain: string
          company_name: string
          created_at?: string
          dimensions?: Json
          employee_count?: number | null
          employee_count_as_of?: string | null
          employee_count_source?: string | null
          id?: string
          industry_nace?: string | null
          ingest_ip_hash?: string | null
          language: string
          overall_score?: number | null
          parent_country?: string | null
          report_id: string
          revenue_bucket?: string | null
          schema_version: string
          scope_deviation?: boolean | null
          scored_dimensions?: number | null
          search_count?: number | null
          source_count?: number | null
          submitted_at: string
          tier: string
          total_dimensions?: number | null
        }
        Update: {
          analysis_date?: string | null
          branch_country?: string | null
          company_domain?: string
          company_name?: string
          created_at?: string
          dimensions?: Json
          employee_count?: number | null
          employee_count_as_of?: string | null
          employee_count_source?: string | null
          id?: string
          industry_nace?: string | null
          ingest_ip_hash?: string | null
          language?: string
          overall_score?: number | null
          parent_country?: string | null
          report_id?: string
          revenue_bucket?: string | null
          schema_version?: string
          scope_deviation?: boolean | null
          scored_dimensions?: number | null
          search_count?: number | null
          source_count?: number | null
          submitted_at?: string
          tier?: string
          total_dimensions?: number | null
        }
        Relationships: []
      }
      interviews: {
        Row: {
          application_id: string
          created_at: string
          duration_minutes: number | null
          id: string
          interview_type: string | null
          interviewer_names: string | null
          location: string | null
          notes: string | null
          outcome: string | null
          scheduled_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          application_id: string
          created_at?: string
          duration_minutes?: number | null
          id?: string
          interview_type?: string | null
          interviewer_names?: string | null
          location?: string | null
          notes?: string | null
          outcome?: string | null
          scheduled_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          application_id?: string
          created_at?: string
          duration_minutes?: number | null
          id?: string
          interview_type?: string | null
          interviewer_names?: string | null
          location?: string | null
          notes?: string | null
          outcome?: string | null
          scheduled_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "interviews_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "job_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      job_applications: {
        Row: {
          applied_date: string | null
          company: string
          created_at: string
          id: string
          job_url: string | null
          location: string | null
          notes: string | null
          position: string
          priority: number | null
          remote_type: string | null
          salary_currency: string | null
          salary_max: number | null
          salary_min: number | null
          source: string | null
          status: Database["public"]["Enums"]["application_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          applied_date?: string | null
          company: string
          created_at?: string
          id?: string
          job_url?: string | null
          location?: string | null
          notes?: string | null
          position: string
          priority?: number | null
          remote_type?: string | null
          salary_currency?: string | null
          salary_max?: number | null
          salary_min?: number | null
          source?: string | null
          status?: Database["public"]["Enums"]["application_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          applied_date?: string | null
          company?: string
          created_at?: string
          id?: string
          job_url?: string | null
          location?: string | null
          notes?: string | null
          position?: string
          priority?: number | null
          remote_type?: string | null
          salary_currency?: string | null
          salary_max?: number | null
          salary_min?: number | null
          source?: string | null
          status?: Database["public"]["Enums"]["application_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      job_leads: {
        Row: {
          ai_concerns: string | null
          ai_match_highlights: string | null
          ai_reasoning: string | null
          ai_score: number | null
          company: string | null
          created_at: string
          email_connection_id: string | null
          id: string
          job_url: string | null
          location: string | null
          posted_text: string | null
          promoted_application_id: string | null
          raw_snippet: string | null
          received_at: string | null
          salary_text: string | null
          source_email_from: string | null
          source_message_id: string | null
          source_subject: string | null
          status: Database["public"]["Enums"]["job_lead_status"]
          title: string | null
          updated_at: string
          user_id: string
          work_type: string | null
        }
        Insert: {
          ai_concerns?: string | null
          ai_match_highlights?: string | null
          ai_reasoning?: string | null
          ai_score?: number | null
          company?: string | null
          created_at?: string
          email_connection_id?: string | null
          id?: string
          job_url?: string | null
          location?: string | null
          posted_text?: string | null
          promoted_application_id?: string | null
          raw_snippet?: string | null
          received_at?: string | null
          salary_text?: string | null
          source_email_from?: string | null
          source_message_id?: string | null
          source_subject?: string | null
          status?: Database["public"]["Enums"]["job_lead_status"]
          title?: string | null
          updated_at?: string
          user_id: string
          work_type?: string | null
        }
        Update: {
          ai_concerns?: string | null
          ai_match_highlights?: string | null
          ai_reasoning?: string | null
          ai_score?: number | null
          company?: string | null
          created_at?: string
          email_connection_id?: string | null
          id?: string
          job_url?: string | null
          location?: string | null
          posted_text?: string | null
          promoted_application_id?: string | null
          raw_snippet?: string | null
          received_at?: string | null
          salary_text?: string | null
          source_email_from?: string | null
          source_message_id?: string | null
          source_subject?: string | null
          status?: Database["public"]["Enums"]["job_lead_status"]
          title?: string | null
          updated_at?: string
          user_id?: string
          work_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_leads_email_connection_id_fkey"
            columns: ["email_connection_id"]
            isOneToOne: false
            referencedRelation: "email_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_events: {
        Row: {
          created_at: string
          event_meta: Json
          event_type: string
          id: string
          lead_id: string
        }
        Insert: {
          created_at?: string
          event_meta?: Json
          event_type: string
          id?: string
          lead_id: string
        }
        Update: {
          created_at?: string
          event_meta?: Json
          event_type?: string
          id?: string
          lead_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          access_token: string
          connect_clicked_at: string | null
          consent_marketing: boolean
          consent_privacy: boolean
          created_at: string
          downloaded_at: string | null
          email: string
          email_sent_at: string | null
          first_name: string
          follow_clicked_at: string | null
          id: string
          linkedin_url: string
          metadata: Json
          role: string | null
          source: string
          status: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          access_token?: string
          connect_clicked_at?: string | null
          consent_marketing?: boolean
          consent_privacy?: boolean
          created_at?: string
          downloaded_at?: string | null
          email: string
          email_sent_at?: string | null
          first_name: string
          follow_clicked_at?: string | null
          id?: string
          linkedin_url: string
          metadata?: Json
          role?: string | null
          source?: string
          status?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          access_token?: string
          connect_clicked_at?: string | null
          consent_marketing?: boolean
          consent_privacy?: boolean
          created_at?: string
          downloaded_at?: string | null
          email?: string
          email_sent_at?: string | null
          first_name?: string
          follow_clicked_at?: string | null
          id?: string
          linkedin_url?: string
          metadata?: Json
          role?: string | null
          source?: string
          status?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          achievements: string | null
          additional_notes: string | null
          available_from: string | null
          bio: string | null
          created_at: string
          current_employer: string | null
          current_role_title: string | null
          deal_breakers: string | null
          display_name: string | null
          email: string | null
          headline: string | null
          id: string
          industries: string[] | null
          languages: string[] | null
          motivation: string | null
          salary_currency: string | null
          salary_expectation_max: number | null
          salary_expectation_min: number | null
          skills: string[] | null
          strengths: string | null
          target_city: string | null
          target_country: string | null
          target_industries: string[] | null
          target_region: string | null
          target_roles: string[] | null
          target_seniority: string | null
          updated_at: string
          weaknesses: string | null
          willing_to_relocate: boolean | null
          work_types: string[] | null
          years_experience: number | null
        }
        Insert: {
          achievements?: string | null
          additional_notes?: string | null
          available_from?: string | null
          bio?: string | null
          created_at?: string
          current_employer?: string | null
          current_role_title?: string | null
          deal_breakers?: string | null
          display_name?: string | null
          email?: string | null
          headline?: string | null
          id: string
          industries?: string[] | null
          languages?: string[] | null
          motivation?: string | null
          salary_currency?: string | null
          salary_expectation_max?: number | null
          salary_expectation_min?: number | null
          skills?: string[] | null
          strengths?: string | null
          target_city?: string | null
          target_country?: string | null
          target_industries?: string[] | null
          target_region?: string | null
          target_roles?: string[] | null
          target_seniority?: string | null
          updated_at?: string
          weaknesses?: string | null
          willing_to_relocate?: boolean | null
          work_types?: string[] | null
          years_experience?: number | null
        }
        Update: {
          achievements?: string | null
          additional_notes?: string | null
          available_from?: string | null
          bio?: string | null
          created_at?: string
          current_employer?: string | null
          current_role_title?: string | null
          deal_breakers?: string | null
          display_name?: string | null
          email?: string | null
          headline?: string | null
          id?: string
          industries?: string[] | null
          languages?: string[] | null
          motivation?: string | null
          salary_currency?: string | null
          salary_expectation_max?: number | null
          salary_expectation_min?: number | null
          skills?: string[] | null
          strengths?: string | null
          target_city?: string | null
          target_country?: string | null
          target_industries?: string[] | null
          target_region?: string | null
          target_roles?: string[] | null
          target_seniority?: string | null
          updated_at?: string
          weaknesses?: string | null
          willing_to_relocate?: boolean | null
          work_types?: string[] | null
          years_experience?: number | null
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
      application_status:
        | "wishlist"
        | "applied"
        | "interviewing"
        | "offer"
        | "rejected"
        | "withdrawn"
        | "accepted"
        | "identifisert"
        | "søknad_generert"
        | "søknad_sendt"
        | "screening"
        | "intervju_1"
        | "intervju_2"
        | "intervju_3"
        | "intervju_4"
        | "case_study"
        | "candidate_profiling"
        | "tilbud_mottatt"
        | "avsluttet"
        | "trukket"
      document_type:
        | "cv"
        | "søknadsbrev"
        | "case_dokument"
        | "referanseliste"
        | "annet"
      email_connection_status: "active" | "expired" | "revoked" | "error"
      email_provider: "google" | "microsoft"
      job_lead_status: "ny" | "avvist" | "promotert" | "arkivert"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
      application_status: [
        "wishlist",
        "applied",
        "interviewing",
        "offer",
        "rejected",
        "withdrawn",
        "accepted",
        "identifisert",
        "søknad_generert",
        "søknad_sendt",
        "screening",
        "intervju_1",
        "intervju_2",
        "intervju_3",
        "intervju_4",
        "case_study",
        "candidate_profiling",
        "tilbud_mottatt",
        "avsluttet",
        "trukket",
      ],
      document_type: [
        "cv",
        "søknadsbrev",
        "case_dokument",
        "referanseliste",
        "annet",
      ],
      email_connection_status: ["active", "expired", "revoked", "error"],
      email_provider: ["google", "microsoft"],
      job_lead_status: ["ny", "avvist", "promotert", "arkivert"],
    },
  },
} as const
