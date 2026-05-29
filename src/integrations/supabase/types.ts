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
      application_process_ratings: {
        Row: {
          application_id: string
          comments: string | null
          company_id: string | null
          created_at: string
          id: string
          q1_acknowledgment: number | null
          q2_communication: number | null
          q3_respect: number | null
          q4_feedback: number | null
          q5_kept_promises: number | null
          q6_would_recommend: number | null
          user_id: string
        }
        Insert: {
          application_id: string
          comments?: string | null
          company_id?: string | null
          created_at?: string
          id?: string
          q1_acknowledgment?: number | null
          q2_communication?: number | null
          q3_respect?: number | null
          q4_feedback?: number | null
          q5_kept_promises?: number | null
          q6_would_recommend?: number | null
          user_id: string
        }
        Update: {
          application_id?: string
          comments?: string | null
          company_id?: string | null
          created_at?: string
          id?: string
          q1_acknowledgment?: number | null
          q2_communication?: number | null
          q3_respect?: number | null
          q4_feedback?: number | null
          q5_kept_promises?: number | null
          q6_would_recommend?: number | null
          user_id?: string
        }
        Relationships: []
      }
      applications: {
        Row: {
          ai_concerns: string | null
          ai_match_highlights: string | null
          ai_reasoning: string | null
          ai_score: number | null
          applied_date: string | null
          available_from: string | null
          company_id: string | null
          company_linkedin: string | null
          company_name: string
          company_size: string | null
          company_website: string | null
          contact_email: string | null
          contact_linkedin: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          cv_used_language: string | null
          cv_used_path: string | null
          followup_notes: string | null
          id: string
          industry: string | null
          internal_assessment: string | null
          is_starred: boolean | null
          job_url: string | null
          letter_generated_at: string | null
          letter_sent_at: string | null
          location: string | null
          next_followup_at: string | null
          notes: string | null
          posted_text: string | null
          priority: Database["public"]["Enums"]["priority_level"] | null
          rating: number | null
          raw_snippet: string | null
          recruiter_email: string | null
          recruiter_name: string | null
          recruiter_phone: string | null
          reminder_sent_at: string | null
          role_title: string | null
          role_type: string | null
          salary_currency: string | null
          salary_range_max: number | null
          salary_range_min: number | null
          salary_text: string | null
          source: string | null
          source_email_from: string | null
          source_subject: string | null
          status: Database["public"]["Enums"]["application_status"]
          updated_at: string
          user_id: string
          work_type: string | null
        }
        Insert: {
          ai_concerns?: string | null
          ai_match_highlights?: string | null
          ai_reasoning?: string | null
          ai_score?: number | null
          applied_date?: string | null
          available_from?: string | null
          company_id?: string | null
          company_linkedin?: string | null
          company_name: string
          company_size?: string | null
          company_website?: string | null
          contact_email?: string | null
          contact_linkedin?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          cv_used_language?: string | null
          cv_used_path?: string | null
          followup_notes?: string | null
          id?: string
          industry?: string | null
          internal_assessment?: string | null
          is_starred?: boolean | null
          job_url?: string | null
          letter_generated_at?: string | null
          letter_sent_at?: string | null
          location?: string | null
          next_followup_at?: string | null
          notes?: string | null
          posted_text?: string | null
          priority?: Database["public"]["Enums"]["priority_level"] | null
          rating?: number | null
          raw_snippet?: string | null
          recruiter_email?: string | null
          recruiter_name?: string | null
          recruiter_phone?: string | null
          reminder_sent_at?: string | null
          role_title?: string | null
          role_type?: string | null
          salary_currency?: string | null
          salary_range_max?: number | null
          salary_range_min?: number | null
          salary_text?: string | null
          source?: string | null
          source_email_from?: string | null
          source_subject?: string | null
          status?: Database["public"]["Enums"]["application_status"]
          updated_at?: string
          user_id: string
          work_type?: string | null
        }
        Update: {
          ai_concerns?: string | null
          ai_match_highlights?: string | null
          ai_reasoning?: string | null
          ai_score?: number | null
          applied_date?: string | null
          available_from?: string | null
          company_id?: string | null
          company_linkedin?: string | null
          company_name?: string
          company_size?: string | null
          company_website?: string | null
          contact_email?: string | null
          contact_linkedin?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          cv_used_language?: string | null
          cv_used_path?: string | null
          followup_notes?: string | null
          id?: string
          industry?: string | null
          internal_assessment?: string | null
          is_starred?: boolean | null
          job_url?: string | null
          letter_generated_at?: string | null
          letter_sent_at?: string | null
          location?: string | null
          next_followup_at?: string | null
          notes?: string | null
          posted_text?: string | null
          priority?: Database["public"]["Enums"]["priority_level"] | null
          rating?: number | null
          raw_snippet?: string | null
          recruiter_email?: string | null
          recruiter_name?: string | null
          recruiter_phone?: string | null
          reminder_sent_at?: string | null
          role_title?: string | null
          role_type?: string | null
          salary_currency?: string | null
          salary_range_max?: number | null
          salary_range_min?: number | null
          salary_text?: string | null
          source?: string | null
          source_email_from?: string | null
          source_subject?: string | null
          status?: Database["public"]["Enums"]["application_status"]
          updated_at?: string
          user_id?: string
          work_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "applications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      atom_evidence_links: {
        Row: {
          ai_generated: boolean
          atom_id: string
          created_at: string
          evidence_id: string
          evidence_label: string | null
          evidence_type: string
          id: string
          manually_verified: boolean
          strength_score: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_generated?: boolean
          atom_id: string
          created_at?: string
          evidence_id: string
          evidence_label?: string | null
          evidence_type: string
          id?: string
          manually_verified?: boolean
          strength_score?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_generated?: boolean
          atom_id?: string
          created_at?: string
          evidence_id?: string
          evidence_label?: string | null
          evidence_type?: string
          id?: string
          manually_verified?: boolean
          strength_score?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "atom_evidence_links_atom_id_fkey"
            columns: ["atom_id"]
            isOneToOne: false
            referencedRelation: "career_atoms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "atom_evidence_links_atom_id_fkey"
            columns: ["atom_id"]
            isOneToOne: false
            referencedRelation: "cv_evidence_atoms"
            referencedColumns: ["id"]
          },
        ]
      }
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
      canonical_opportunities: {
        Row: {
          created_at: string
          display_company: string | null
          display_location: string | null
          display_title: string | null
          display_url: string
          id: string
          identity_fingerprint: string
          merge_summary: string | null
          primary_source: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_company?: string | null
          display_location?: string | null
          display_title?: string | null
          display_url: string
          id?: string
          identity_fingerprint: string
          merge_summary?: string | null
          primary_source?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_company?: string | null
          display_location?: string | null
          display_title?: string | null
          display_url?: string
          id?: string
          identity_fingerprint?: string
          merge_summary?: string | null
          primary_source?: string
          updated_at?: string
        }
        Relationships: []
      }
      case_documents: {
        Row: {
          case_id: string
          created_at: string
          display_order: number | null
          document_id: string
          id: string
          relationship_type: string
          user_id: string
        }
        Insert: {
          case_id: string
          created_at?: string
          display_order?: number | null
          document_id: string
          id?: string
          relationship_type?: string
          user_id: string
        }
        Update: {
          case_id?: string
          created_at?: string
          display_order?: number | null
          document_id?: string
          id?: string
          relationship_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_documents_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "professional_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_documents_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          agg_process_count: number
          agg_process_overall: number | null
          agg_process_q1: number | null
          agg_process_q2: number | null
          agg_process_q3: number | null
          agg_process_q4: number | null
          agg_process_q5: number | null
          agg_process_q6: number | null
          ai_dimension_notes: Json | null
          created_at: string
          domain: string | null
          financials: Json | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          agg_process_count?: number
          agg_process_overall?: number | null
          agg_process_q1?: number | null
          agg_process_q2?: number | null
          agg_process_q3?: number | null
          agg_process_q4?: number | null
          agg_process_q5?: number | null
          agg_process_q6?: number | null
          ai_dimension_notes?: Json | null
          created_at?: string
          domain?: string | null
          financials?: Json | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          agg_process_count?: number
          agg_process_overall?: number | null
          agg_process_q1?: number | null
          agg_process_q2?: number | null
          agg_process_q3?: number | null
          agg_process_q4?: number | null
          agg_process_q5?: number | null
          agg_process_q6?: number | null
          ai_dimension_notes?: Json | null
          created_at?: string
          domain?: string | null
          financials?: Json | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
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
      cv_consent_log: {
        Row: {
          consent_given: boolean
          consent_type: string
          context: string | null
          created_at: string
          granted_at: string
          id: string
          ip_address: string | null
          revoked_at: string | null
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          consent_given?: boolean
          consent_type: string
          context?: string | null
          created_at?: string
          granted_at?: string
          id?: string
          ip_address?: string | null
          revoked_at?: string | null
          updated_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          consent_given?: boolean
          consent_type?: string
          context?: string | null
          created_at?: string
          granted_at?: string
          id?: string
          ip_address?: string | null
          revoked_at?: string | null
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      cv_evidence_atoms: {
        Row: {
          atom_type: string
          canonical_atom_id: string | null
          career_stage_relevance: string[] | null
          confidence: string
          content_en: string | null
          content_no: string | null
          created_at: string
          dedupe_key: string | null
          evidence_scope: string | null
          id: string
          last_seen_at: string | null
          parent_atom_id: string | null
          relevance_score: number | null
          role_relevance_tags: string[] | null
          source_quote: string | null
          source_ref: string | null
          source_type: string
          structured_data: Json | null
          updated_at: string
          user_confirmed: boolean
          user_id: string
          user_locked: boolean
        }
        Insert: {
          atom_type: string
          canonical_atom_id?: string | null
          career_stage_relevance?: string[] | null
          confidence?: string
          content_en?: string | null
          content_no?: string | null
          created_at?: string
          dedupe_key?: string | null
          evidence_scope?: string | null
          id?: string
          last_seen_at?: string | null
          parent_atom_id?: string | null
          relevance_score?: number | null
          role_relevance_tags?: string[] | null
          source_quote?: string | null
          source_ref?: string | null
          source_type: string
          structured_data?: Json | null
          updated_at?: string
          user_confirmed?: boolean
          user_id: string
          user_locked?: boolean
        }
        Update: {
          atom_type?: string
          canonical_atom_id?: string | null
          career_stage_relevance?: string[] | null
          confidence?: string
          content_en?: string | null
          content_no?: string | null
          created_at?: string
          dedupe_key?: string | null
          evidence_scope?: string | null
          id?: string
          last_seen_at?: string | null
          parent_atom_id?: string | null
          relevance_score?: number | null
          role_relevance_tags?: string[] | null
          source_quote?: string | null
          source_ref?: string | null
          source_type?: string
          structured_data?: Json | null
          updated_at?: string
          user_confirmed?: boolean
          user_id?: string
          user_locked?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "cv_evidence_atoms_canonical_atom_id_fkey"
            columns: ["canonical_atom_id"]
            isOneToOne: false
            referencedRelation: "career_atoms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cv_evidence_atoms_canonical_atom_id_fkey"
            columns: ["canonical_atom_id"]
            isOneToOne: false
            referencedRelation: "cv_evidence_atoms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cv_evidence_atoms_parent_atom_id_fkey"
            columns: ["parent_atom_id"]
            isOneToOne: false
            referencedRelation: "career_atoms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cv_evidence_atoms_parent_atom_id_fkey"
            columns: ["parent_atom_id"]
            isOneToOne: false
            referencedRelation: "cv_evidence_atoms"
            referencedColumns: ["id"]
          },
        ]
      }
      cv_imports: {
        Row: {
          atoms_committed_count: number
          atoms_created_count: number
          committed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          import_type: string
          parsed_at: string | null
          raw_parsed_data: Json | null
          source_file_path: string | null
          source_filename: string | null
          started_at: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          atoms_committed_count?: number
          atoms_created_count?: number
          committed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          import_type: string
          parsed_at?: string | null
          raw_parsed_data?: Json | null
          source_file_path?: string | null
          source_filename?: string | null
          started_at?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          atoms_committed_count?: number
          atoms_created_count?: number
          committed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          import_type?: string
          parsed_at?: string | null
          raw_parsed_data?: Json | null
          source_file_path?: string | null
          source_filename?: string | null
          started_at?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      documentation_package_items: {
        Row: {
          created_at: string
          display_order: number | null
          id: string
          included: boolean
          item_id: string
          item_type: string
          notes: string | null
          package_id: string
          title_override: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_order?: number | null
          id?: string
          included?: boolean
          item_id: string
          item_type: string
          notes?: string | null
          package_id: string
          title_override?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_order?: number | null
          id?: string
          included?: boolean
          item_id?: string
          item_type?: string
          notes?: string | null
          package_id?: string
          title_override?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "documentation_package_items_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "documentation_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      documentation_packages: {
        Row: {
          application_id: string | null
          created_at: string
          description: string | null
          expires_at: string | null
          id: string
          job_lead_id: string | null
          last_shared_at: string | null
          package_type: string
          share_token: string | null
          status: string
          target_company: string | null
          target_role: string | null
          title: string
          updated_at: string
          user_id: string
          visibility: string
        }
        Insert: {
          application_id?: string | null
          created_at?: string
          description?: string | null
          expires_at?: string | null
          id?: string
          job_lead_id?: string | null
          last_shared_at?: string | null
          package_type?: string
          share_token?: string | null
          status?: string
          target_company?: string | null
          target_role?: string | null
          title: string
          updated_at?: string
          user_id: string
          visibility?: string
        }
        Update: {
          application_id?: string | null
          created_at?: string
          description?: string | null
          expires_at?: string | null
          id?: string
          job_lead_id?: string | null
          last_shared_at?: string | null
          package_type?: string
          share_token?: string | null
          status?: string
          target_company?: string | null
          target_role?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "documentation_packages_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentation_packages_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications_with_urgency"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentation_packages_job_lead_id_fkey"
            columns: ["job_lead_id"]
            isOneToOne: false
            referencedRelation: "job_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          ai_processed_at: string | null
          ai_summary: string | null
          application_id: string | null
          atom_ids: string[] | null
          atom_snapshot: Json | null
          ats_rules_version: string | null
          career_stage_relevance: string[] | null
          company_name: string | null
          confidentiality_level: string | null
          content_text: string | null
          created_at: string
          customization_notes: string | null
          deleted_at: string | null
          document_type: Database["public"]["Enums"]["document_type"]
          documentation_category: string | null
          documentation_status: string | null
          documentation_subcategory: string | null
          embedding_status: string | null
          evidence_strength: number | null
          extracted_text: string | null
          file_name: string | null
          file_path: string | null
          file_size_bytes: number | null
          guard_result: Json | null
          guard_version: string | null
          id: string
          is_base_version: boolean | null
          is_portfolio_featured: boolean | null
          mime_type: string | null
          quality_result: Json | null
          render_language: string | null
          render_template_version: string | null
          role_relevance_tags: string[] | null
          source_context: string | null
          tailored_for: string | null
          title: string
          updated_at: string
          user_id: string
          version: number | null
          visibility: string | null
        }
        Insert: {
          ai_processed_at?: string | null
          ai_summary?: string | null
          application_id?: string | null
          atom_ids?: string[] | null
          atom_snapshot?: Json | null
          ats_rules_version?: string | null
          career_stage_relevance?: string[] | null
          company_name?: string | null
          confidentiality_level?: string | null
          content_text?: string | null
          created_at?: string
          customization_notes?: string | null
          deleted_at?: string | null
          document_type: Database["public"]["Enums"]["document_type"]
          documentation_category?: string | null
          documentation_status?: string | null
          documentation_subcategory?: string | null
          embedding_status?: string | null
          evidence_strength?: number | null
          extracted_text?: string | null
          file_name?: string | null
          file_path?: string | null
          file_size_bytes?: number | null
          guard_result?: Json | null
          guard_version?: string | null
          id?: string
          is_base_version?: boolean | null
          is_portfolio_featured?: boolean | null
          mime_type?: string | null
          quality_result?: Json | null
          render_language?: string | null
          render_template_version?: string | null
          role_relevance_tags?: string[] | null
          source_context?: string | null
          tailored_for?: string | null
          title: string
          updated_at?: string
          user_id: string
          version?: number | null
          visibility?: string | null
        }
        Update: {
          ai_processed_at?: string | null
          ai_summary?: string | null
          application_id?: string | null
          atom_ids?: string[] | null
          atom_snapshot?: Json | null
          ats_rules_version?: string | null
          career_stage_relevance?: string[] | null
          company_name?: string | null
          confidentiality_level?: string | null
          content_text?: string | null
          created_at?: string
          customization_notes?: string | null
          deleted_at?: string | null
          document_type?: Database["public"]["Enums"]["document_type"]
          documentation_category?: string | null
          documentation_status?: string | null
          documentation_subcategory?: string | null
          embedding_status?: string | null
          evidence_strength?: number | null
          extracted_text?: string | null
          file_name?: string | null
          file_path?: string | null
          file_size_bytes?: number | null
          guard_result?: Json | null
          guard_version?: string | null
          id?: string
          is_base_version?: boolean | null
          is_portfolio_featured?: boolean | null
          mime_type?: string | null
          quality_result?: Json | null
          render_language?: string | null
          render_template_version?: string | null
          role_relevance_tags?: string[] | null
          source_context?: string | null
          tailored_for?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          version?: number | null
          visibility?: string | null
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
      job_ads: {
        Row: {
          about_company: string | null
          about_role: string | null
          application_deadline: string | null
          application_id: string
          created_at: string
          fit_analysis: string | null
          id: string
          ideal_candidate: string | null
          imported_at: string | null
          key_requirements: string[] | null
          must_have_keywords: string[] | null
          nice_to_have: string[] | null
          parsed_company: string | null
          parsed_location: string | null
          parsed_role: string | null
          parsed_work_type: string | null
          raw_text: string | null
          salary_info: string | null
          source_url: string | null
          updated_at: string
        }
        Insert: {
          about_company?: string | null
          about_role?: string | null
          application_deadline?: string | null
          application_id: string
          created_at?: string
          fit_analysis?: string | null
          id?: string
          ideal_candidate?: string | null
          imported_at?: string | null
          key_requirements?: string[] | null
          must_have_keywords?: string[] | null
          nice_to_have?: string[] | null
          parsed_company?: string | null
          parsed_location?: string | null
          parsed_role?: string | null
          parsed_work_type?: string | null
          raw_text?: string | null
          salary_info?: string | null
          source_url?: string | null
          updated_at?: string
        }
        Update: {
          about_company?: string | null
          about_role?: string | null
          application_deadline?: string | null
          application_id?: string
          created_at?: string
          fit_analysis?: string | null
          id?: string
          ideal_candidate?: string | null
          imported_at?: string | null
          key_requirements?: string[] | null
          must_have_keywords?: string[] | null
          nice_to_have?: string[] | null
          parsed_company?: string | null
          parsed_location?: string | null
          parsed_role?: string | null
          parsed_work_type?: string | null
          raw_text?: string | null
          salary_info?: string | null
          source_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_ads_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_ads_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications_with_urgency"
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
      job_listings: {
        Row: {
          created_at: string | null
          description: string | null
          employer: string | null
          expires_at: string | null
          external_id: string
          id: string
          is_expired: boolean | null
          location: string | null
          municipality: string | null
          municipality_code: string | null
          published_at: string | null
          raw_data: Json | null
          salary: string | null
          salary_currency: string | null
          salary_max: number | null
          salary_min: number | null
          source: string
          source_url: string | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          employer?: string | null
          expires_at?: string | null
          external_id: string
          id?: string
          is_expired?: boolean | null
          location?: string | null
          municipality?: string | null
          municipality_code?: string | null
          published_at?: string | null
          raw_data?: Json | null
          salary?: string | null
          salary_currency?: string | null
          salary_max?: number | null
          salary_min?: number | null
          source?: string
          source_url?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          employer?: string | null
          expires_at?: string | null
          external_id?: string
          id?: string
          is_expired?: boolean | null
          location?: string | null
          municipality?: string | null
          municipality_code?: string | null
          published_at?: string | null
          raw_data?: Json | null
          salary?: string | null
          salary_currency?: string | null
          salary_max?: number | null
          salary_min?: number | null
          source?: string
          source_url?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      lead_dedupe_keys: {
        Row: {
          created_at: string
          dedupe_key: string
          id: string
          ref_id: string | null
          ref_table: string | null
          source: string
          source_priority: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          dedupe_key: string
          id?: string
          ref_id?: string | null
          ref_table?: string | null
          source: string
          source_priority?: number
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          dedupe_key?: string
          id?: string
          ref_id?: string | null
          ref_table?: string | null
          source?: string
          source_priority?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
      opportunity_dedup_candidates: {
        Row: {
          confidence: number | null
          created_at: string
          evidence: Json
          fingerprint_a: string
          fingerprint_b: string
          id: string
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          evidence?: Json
          fingerprint_a: string
          fingerprint_b: string
          id?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          confidence?: number | null
          created_at?: string
          evidence?: Json
          fingerprint_a?: string
          fingerprint_b?: string
          id?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      opportunity_dedup_decisions: {
        Row: {
          decided_at: string
          decision_type: string
          id: string
          keep_canonical_id: string | null
          merged_canonical_id: string | null
          reason: string
          user_id: string | null
        }
        Insert: {
          decided_at?: string
          decision_type: string
          id?: string
          keep_canonical_id?: string | null
          merged_canonical_id?: string | null
          reason: string
          user_id?: string | null
        }
        Update: {
          decided_at?: string
          decision_type?: string
          id?: string
          keep_canonical_id?: string | null
          merged_canonical_id?: string | null
          reason?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_dedup_decisions_keep_canonical_id_fkey"
            columns: ["keep_canonical_id"]
            isOneToOne: false
            referencedRelation: "canonical_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_dedup_decisions_merged_canonical_id_fkey"
            columns: ["merged_canonical_id"]
            isOneToOne: false
            referencedRelation: "canonical_opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunity_source_links: {
        Row: {
          canonical_opportunity_id: string
          created_at: string
          id: string
          link_role: string
          merge_reason: string
          source_posting_id: string
        }
        Insert: {
          canonical_opportunity_id: string
          created_at?: string
          id?: string
          link_role: string
          merge_reason?: string
          source_posting_id: string
        }
        Update: {
          canonical_opportunity_id?: string
          created_at?: string
          id?: string
          link_role?: string
          merge_reason?: string
          source_posting_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_source_links_canonical_opportunity_id_fkey"
            columns: ["canonical_opportunity_id"]
            isOneToOne: false
            referencedRelation: "canonical_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_source_links_source_posting_id_fkey"
            columns: ["source_posting_id"]
            isOneToOne: false
            referencedRelation: "source_postings"
            referencedColumns: ["id"]
          },
        ]
      }
      professional_cases: {
        Row: {
          actions_taken: string | null
          ai_summary: string | null
          atom_ids: string[] | null
          career_stage_relevance: string[] | null
          company_name: string | null
          created_at: string
          id: string
          industry: string | null
          responsibility: string | null
          results: string | null
          role_context: string | null
          role_relevance_tags: string[] | null
          situation: string | null
          status: string
          summary: string | null
          time_period: string | null
          title: string
          updated_at: string
          user_id: string
          visibility: string
        }
        Insert: {
          actions_taken?: string | null
          ai_summary?: string | null
          atom_ids?: string[] | null
          career_stage_relevance?: string[] | null
          company_name?: string | null
          created_at?: string
          id?: string
          industry?: string | null
          responsibility?: string | null
          results?: string | null
          role_context?: string | null
          role_relevance_tags?: string[] | null
          situation?: string | null
          status?: string
          summary?: string | null
          time_period?: string | null
          title: string
          updated_at?: string
          user_id: string
          visibility?: string
        }
        Update: {
          actions_taken?: string | null
          ai_summary?: string | null
          atom_ids?: string[] | null
          career_stage_relevance?: string[] | null
          company_name?: string | null
          created_at?: string
          id?: string
          industry?: string | null
          responsibility?: string | null
          results?: string | null
          role_context?: string | null
          role_relevance_tags?: string[] | null
          situation?: string | null
          status?: string
          summary?: string | null
          time_period?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          visibility?: string
        }
        Relationships: []
      }
      professional_results: {
        Row: {
          atom_ids: string[] | null
          baseline_value: string | null
          company_name: string | null
          created_at: string
          description: string | null
          evidence_strength: number | null
          final_value: string | null
          id: string
          metric_name: string | null
          metric_unit: string | null
          metric_value: string | null
          role_context: string | null
          time_period: string | null
          title: string
          updated_at: string
          user_id: string
          verified: boolean
          visibility: string
        }
        Insert: {
          atom_ids?: string[] | null
          baseline_value?: string | null
          company_name?: string | null
          created_at?: string
          description?: string | null
          evidence_strength?: number | null
          final_value?: string | null
          id?: string
          metric_name?: string | null
          metric_unit?: string | null
          metric_value?: string | null
          role_context?: string | null
          time_period?: string | null
          title: string
          updated_at?: string
          user_id: string
          verified?: boolean
          visibility?: string
        }
        Update: {
          atom_ids?: string[] | null
          baseline_value?: string | null
          company_name?: string | null
          created_at?: string
          description?: string | null
          evidence_strength?: number | null
          final_value?: string | null
          id?: string
          metric_name?: string | null
          metric_unit?: string | null
          metric_value?: string | null
          role_context?: string | null
          time_period?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          verified?: boolean
          visibility?: string
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
          cv_en_pdf_path: string | null
          cv_en_updated_at: string | null
          cv_en_word_path: string | null
          cv_no_pdf_path: string | null
          cv_no_updated_at: string | null
          cv_no_word_path: string | null
          deal_breakers: string | null
          display_name: string | null
          email: string | null
          full_name: string | null
          given_name: string | null
          headline: string | null
          id: string
          industries: string[] | null
          job_search_keywords: string | null
          languages: string[] | null
          linkedin_connected_at: string | null
          linkedin_email_verified: boolean | null
          linkedin_headline: string | null
          linkedin_id: string | null
          linkedin_locale: string | null
          linkedin_picture_url: string | null
          linkedin_vanity_url: string | null
          listings_last_fetched_at: string | null
          motivation: string | null
          onboarding_completed: boolean | null
          onboarding_completed_at: string | null
          onboarding_started_at: string | null
          onboarding_step: number | null
          phone: string | null
          preferred_locations: string[] | null
          salary_currency: string | null
          salary_expectation_max: number | null
          salary_expectation_min: number | null
          skills: string[] | null
          strengths: string | null
          target_city: string | null
          target_country: string | null
          target_industries: string[] | null
          target_region: string | null
          target_role: string | null
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
          cv_en_pdf_path?: string | null
          cv_en_updated_at?: string | null
          cv_en_word_path?: string | null
          cv_no_pdf_path?: string | null
          cv_no_updated_at?: string | null
          cv_no_word_path?: string | null
          deal_breakers?: string | null
          display_name?: string | null
          email?: string | null
          full_name?: string | null
          given_name?: string | null
          headline?: string | null
          id: string
          industries?: string[] | null
          job_search_keywords?: string | null
          languages?: string[] | null
          linkedin_connected_at?: string | null
          linkedin_email_verified?: boolean | null
          linkedin_headline?: string | null
          linkedin_id?: string | null
          linkedin_locale?: string | null
          linkedin_picture_url?: string | null
          linkedin_vanity_url?: string | null
          listings_last_fetched_at?: string | null
          motivation?: string | null
          onboarding_completed?: boolean | null
          onboarding_completed_at?: string | null
          onboarding_started_at?: string | null
          onboarding_step?: number | null
          phone?: string | null
          preferred_locations?: string[] | null
          salary_currency?: string | null
          salary_expectation_max?: number | null
          salary_expectation_min?: number | null
          skills?: string[] | null
          strengths?: string | null
          target_city?: string | null
          target_country?: string | null
          target_industries?: string[] | null
          target_region?: string | null
          target_role?: string | null
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
          cv_en_pdf_path?: string | null
          cv_en_updated_at?: string | null
          cv_en_word_path?: string | null
          cv_no_pdf_path?: string | null
          cv_no_updated_at?: string | null
          cv_no_word_path?: string | null
          deal_breakers?: string | null
          display_name?: string | null
          email?: string | null
          full_name?: string | null
          given_name?: string | null
          headline?: string | null
          id?: string
          industries?: string[] | null
          job_search_keywords?: string | null
          languages?: string[] | null
          linkedin_connected_at?: string | null
          linkedin_email_verified?: boolean | null
          linkedin_headline?: string | null
          linkedin_id?: string | null
          linkedin_locale?: string | null
          linkedin_picture_url?: string | null
          linkedin_vanity_url?: string | null
          listings_last_fetched_at?: string | null
          motivation?: string | null
          onboarding_completed?: boolean | null
          onboarding_completed_at?: string | null
          onboarding_started_at?: string | null
          onboarding_step?: number | null
          phone?: string | null
          preferred_locations?: string[] | null
          salary_currency?: string | null
          salary_expectation_max?: number | null
          salary_expectation_min?: number | null
          skills?: string[] | null
          strengths?: string | null
          target_city?: string | null
          target_country?: string | null
          target_industries?: string[] | null
          target_region?: string | null
          target_role?: string | null
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
      source_postings: {
        Row: {
          company: string | null
          created_at: string
          description_excerpt: string | null
          display_url: string
          id: string
          identity_fingerprint: string
          listing_id: string | null
          location: string | null
          published_at: string | null
          raw_payload: Json | null
          raw_url: string
          source: string
          source_external_id: string
          title: string | null
          updated_at: string
        }
        Insert: {
          company?: string | null
          created_at?: string
          description_excerpt?: string | null
          display_url: string
          id?: string
          identity_fingerprint: string
          listing_id?: string | null
          location?: string | null
          published_at?: string | null
          raw_payload?: Json | null
          raw_url: string
          source: string
          source_external_id: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          company?: string | null
          created_at?: string
          description_excerpt?: string | null
          display_url?: string
          id?: string
          identity_fingerprint?: string
          listing_id?: string | null
          location?: string | null
          published_at?: string | null
          raw_payload?: Json | null
          raw_url?: string
          source?: string
          source_external_id?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_postings_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "job_listings"
            referencedColumns: ["id"]
          },
        ]
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
      user_company_ratings: {
        Row: {
          ai_candidate_fit_reasoning: string | null
          ai_candidate_fit_score: number | null
          applied_here: boolean | null
          career_development_score: number | null
          company_id: string
          created_at: string
          culture_score: number | null
          financial_stability_score: number | null
          id: string
          interviewed_here: boolean | null
          leadership_score: number | null
          mission_score: number | null
          overall_score: number | null
          updated_at: string
          user_id: string
          user_notes: string | null
          work_environment_score: number | null
          worked_here: boolean | null
        }
        Insert: {
          ai_candidate_fit_reasoning?: string | null
          ai_candidate_fit_score?: number | null
          applied_here?: boolean | null
          career_development_score?: number | null
          company_id: string
          created_at?: string
          culture_score?: number | null
          financial_stability_score?: number | null
          id?: string
          interviewed_here?: boolean | null
          leadership_score?: number | null
          mission_score?: number | null
          overall_score?: number | null
          updated_at?: string
          user_id: string
          user_notes?: string | null
          work_environment_score?: number | null
          worked_here?: boolean | null
        }
        Update: {
          ai_candidate_fit_reasoning?: string | null
          ai_candidate_fit_score?: number | null
          applied_here?: boolean | null
          career_development_score?: number | null
          company_id?: string
          created_at?: string
          culture_score?: number | null
          financial_stability_score?: number | null
          id?: string
          interviewed_here?: boolean | null
          leadership_score?: number | null
          mission_score?: number | null
          overall_score?: number | null
          updated_at?: string
          user_id?: string
          user_notes?: string | null
          work_environment_score?: number | null
          worked_here?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "user_company_ratings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      user_job_listing_status: {
        Row: {
          ai_concerns: string | null
          ai_match_highlights: string | null
          ai_reasoning: string | null
          ai_score: number | null
          ai_scored_at: string | null
          created_at: string | null
          id: string
          listing_id: string
          relevance_score: number | null
          status: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          ai_concerns?: string | null
          ai_match_highlights?: string | null
          ai_reasoning?: string | null
          ai_score?: number | null
          ai_scored_at?: string | null
          created_at?: string | null
          id?: string
          listing_id: string
          relevance_score?: number | null
          status?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          ai_concerns?: string | null
          ai_match_highlights?: string | null
          ai_reasoning?: string | null
          ai_score?: number | null
          ai_scored_at?: string | null
          created_at?: string | null
          id?: string
          listing_id?: string
          relevance_score?: number | null
          status?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_job_listing_status_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "job_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      user_opportunities: {
        Row: {
          ai_concerns: string | null
          ai_match_highlights: string | null
          ai_reasoning: string | null
          ai_score: number | null
          ai_scored_at: string | null
          canonical_opportunity_id: string
          card_company: string | null
          card_display_url: string
          card_location: string | null
          card_published_at: string | null
          card_raw_url: string
          card_salary: string | null
          card_salary_currency: string | null
          card_salary_max: number | null
          card_salary_min: number | null
          card_title: string | null
          created_at: string
          id: string
          identity_fingerprint: string
          legacy_listing_id: string | null
          legacy_listing_status_id: string | null
          relevance_score: number | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_concerns?: string | null
          ai_match_highlights?: string | null
          ai_reasoning?: string | null
          ai_score?: number | null
          ai_scored_at?: string | null
          canonical_opportunity_id: string
          card_company?: string | null
          card_display_url: string
          card_location?: string | null
          card_published_at?: string | null
          card_raw_url: string
          card_salary?: string | null
          card_salary_currency?: string | null
          card_salary_max?: number | null
          card_salary_min?: number | null
          card_title?: string | null
          created_at?: string
          id?: string
          identity_fingerprint: string
          legacy_listing_id?: string | null
          legacy_listing_status_id?: string | null
          relevance_score?: number | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_concerns?: string | null
          ai_match_highlights?: string | null
          ai_reasoning?: string | null
          ai_score?: number | null
          ai_scored_at?: string | null
          canonical_opportunity_id?: string
          card_company?: string | null
          card_display_url?: string
          card_location?: string | null
          card_published_at?: string | null
          card_raw_url?: string
          card_salary?: string | null
          card_salary_currency?: string | null
          card_salary_max?: number | null
          card_salary_min?: number | null
          card_title?: string | null
          created_at?: string
          id?: string
          identity_fingerprint?: string
          legacy_listing_id?: string | null
          legacy_listing_status_id?: string | null
          relevance_score?: number | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_opportunities_canonical_opportunity_id_fkey"
            columns: ["canonical_opportunity_id"]
            isOneToOne: false
            referencedRelation: "canonical_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_opportunities_legacy_listing_id_fkey"
            columns: ["legacy_listing_id"]
            isOneToOne: false
            referencedRelation: "job_listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_opportunities_legacy_listing_status_id_fkey"
            columns: ["legacy_listing_status_id"]
            isOneToOne: false
            referencedRelation: "user_job_listing_status"
            referencedColumns: ["id"]
          },
        ]
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
      applications_with_urgency: {
        Row: {
          applied_date: string | null
          available_from: string | null
          company_linkedin: string | null
          company_name: string | null
          company_size: string | null
          company_website: string | null
          contact_email: string | null
          contact_linkedin: string | null
          contact_name: string | null
          created_at: string | null
          days_since_applied: number | null
          days_since_update: number | null
          document_count: number | null
          id: string | null
          industry: string | null
          internal_assessment: string | null
          is_starred: boolean | null
          job_url: string | null
          location: string | null
          meeting_count: number | null
          notes: string | null
          open_tasks: number | null
          priority: Database["public"]["Enums"]["priority_level"] | null
          rating: number | null
          recruiter_email: string | null
          recruiter_name: string | null
          role_title: string | null
          role_type: string | null
          salary_currency: string | null
          salary_range_max: number | null
          salary_range_min: number | null
          source: string | null
          stage_count: number | null
          status: Database["public"]["Enums"]["application_status"] | null
          updated_at: string | null
          urgency_level: string | null
          user_id: string | null
          work_type: string | null
        }
        Insert: {
          applied_date?: string | null
          available_from?: string | null
          company_linkedin?: string | null
          company_name?: string | null
          company_size?: string | null
          company_website?: string | null
          contact_email?: string | null
          contact_linkedin?: string | null
          contact_name?: string | null
          created_at?: string | null
          days_since_applied?: never
          days_since_update?: never
          document_count?: never
          id?: string | null
          industry?: string | null
          internal_assessment?: string | null
          is_starred?: boolean | null
          job_url?: string | null
          location?: string | null
          meeting_count?: never
          notes?: string | null
          open_tasks?: never
          priority?: Database["public"]["Enums"]["priority_level"] | null
          rating?: number | null
          recruiter_email?: string | null
          recruiter_name?: string | null
          role_title?: string | null
          role_type?: string | null
          salary_currency?: string | null
          salary_range_max?: number | null
          salary_range_min?: number | null
          source?: string | null
          stage_count?: never
          status?: Database["public"]["Enums"]["application_status"] | null
          updated_at?: string | null
          urgency_level?: never
          user_id?: string | null
          work_type?: string | null
        }
        Update: {
          applied_date?: string | null
          available_from?: string | null
          company_linkedin?: string | null
          company_name?: string | null
          company_size?: string | null
          company_website?: string | null
          contact_email?: string | null
          contact_linkedin?: string | null
          contact_name?: string | null
          created_at?: string | null
          days_since_applied?: never
          days_since_update?: never
          document_count?: never
          id?: string | null
          industry?: string | null
          internal_assessment?: string | null
          is_starred?: boolean | null
          job_url?: string | null
          location?: string | null
          meeting_count?: never
          notes?: string | null
          open_tasks?: never
          priority?: Database["public"]["Enums"]["priority_level"] | null
          rating?: number | null
          recruiter_email?: string | null
          recruiter_name?: string | null
          role_title?: string | null
          role_type?: string | null
          salary_currency?: string | null
          salary_range_max?: number | null
          salary_range_min?: number | null
          source?: string | null
          stage_count?: never
          status?: Database["public"]["Enums"]["application_status"] | null
          updated_at?: string | null
          urgency_level?: never
          user_id?: string | null
          work_type?: string | null
        }
        Relationships: []
      }
      career_atoms: {
        Row: {
          atom_type: string | null
          canonical_atom_id: string | null
          career_stage_relevance: string[] | null
          confidence: string | null
          content_en: string | null
          content_no: string | null
          created_at: string | null
          dedupe_key: string | null
          evidence_scope: string | null
          id: string | null
          last_seen_at: string | null
          parent_atom_id: string | null
          relevance_score: number | null
          role_relevance_tags: string[] | null
          source_quote: string | null
          source_ref: string | null
          source_type: string | null
          structured_data: Json | null
          updated_at: string | null
          user_confirmed: boolean | null
          user_id: string | null
          user_locked: boolean | null
        }
        Insert: {
          atom_type?: string | null
          canonical_atom_id?: string | null
          career_stage_relevance?: string[] | null
          confidence?: string | null
          content_en?: string | null
          content_no?: string | null
          created_at?: string | null
          dedupe_key?: string | null
          evidence_scope?: string | null
          id?: string | null
          last_seen_at?: string | null
          parent_atom_id?: string | null
          relevance_score?: number | null
          role_relevance_tags?: string[] | null
          source_quote?: string | null
          source_ref?: string | null
          source_type?: string | null
          structured_data?: Json | null
          updated_at?: string | null
          user_confirmed?: boolean | null
          user_id?: string | null
          user_locked?: boolean | null
        }
        Update: {
          atom_type?: string | null
          canonical_atom_id?: string | null
          career_stage_relevance?: string[] | null
          confidence?: string | null
          content_en?: string | null
          content_no?: string | null
          created_at?: string | null
          dedupe_key?: string | null
          evidence_scope?: string | null
          id?: string | null
          last_seen_at?: string | null
          parent_atom_id?: string | null
          relevance_score?: number | null
          role_relevance_tags?: string[] | null
          source_quote?: string | null
          source_ref?: string | null
          source_type?: string | null
          structured_data?: Json | null
          updated_at?: string | null
          user_confirmed?: boolean | null
          user_id?: string | null
          user_locked?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "cv_evidence_atoms_canonical_atom_id_fkey"
            columns: ["canonical_atom_id"]
            isOneToOne: false
            referencedRelation: "career_atoms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cv_evidence_atoms_canonical_atom_id_fkey"
            columns: ["canonical_atom_id"]
            isOneToOne: false
            referencedRelation: "cv_evidence_atoms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cv_evidence_atoms_parent_atom_id_fkey"
            columns: ["parent_atom_id"]
            isOneToOne: false
            referencedRelation: "career_atoms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cv_evidence_atoms_parent_atom_id_fkey"
            columns: ["parent_atom_id"]
            isOneToOne: false
            referencedRelation: "cv_evidence_atoms"
            referencedColumns: ["id"]
          },
        ]
      }
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
      normalize_lead_key: {
        Args: {
          p_company: string
          p_location: string
          p_title: string
          p_url: string
        }
        Returns: string
      }
      opportunity_fingerprint: {
        Args: { p_company: string; p_location: string; p_title: string }
        Returns: string
      }
      prune_stale_leads: { Args: { p_user_id: string }; Returns: undefined }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      refresh_company_process_aggregate: {
        Args: { p_company_id: string }
        Returns: undefined
      }
      register_lead: {
        Args: {
          p_dedupe_key: string
          p_priority: number
          p_ref_id: string
          p_ref_table: string
          p_source: string
          p_user_id: string
        }
        Returns: boolean
      }
      sync_user_opportunity_ai_from_legacy: {
        Args: { p_user_id: string }
        Returns: undefined
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
      priority_level: "høy" | "middels" | "lav"
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
      priority_level: ["høy", "middels", "lav"],
    },
  },
} as const
