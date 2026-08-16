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
          {
            foreignKeyName: "applications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "employer_search_v1"
            referencedColumns: ["company_id"]
          },
        ]
      }
      atom_enrichment_batches: {
        Row: {
          context: Json
          created_at: string
          id: string
          input_signature: string | null
          model_run_id: string | null
          normalizer_version: string | null
          notes: string | null
          source_hash: string | null
          source_id: string | null
          source_record_id: string | null
          source_table: string | null
          source_type: string
          status: Database["public"]["Enums"]["atom_enrichment_batch_status"]
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          context?: Json
          created_at?: string
          id?: string
          input_signature?: string | null
          model_run_id?: string | null
          normalizer_version?: string | null
          notes?: string | null
          source_hash?: string | null
          source_id?: string | null
          source_record_id?: string | null
          source_table?: string | null
          source_type: string
          status?: Database["public"]["Enums"]["atom_enrichment_batch_status"]
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          context?: Json
          created_at?: string
          id?: string
          input_signature?: string | null
          model_run_id?: string | null
          normalizer_version?: string | null
          notes?: string | null
          source_hash?: string | null
          source_id?: string | null
          source_record_id?: string | null
          source_table?: string | null
          source_type?: string
          status?: Database["public"]["Enums"]["atom_enrichment_batch_status"]
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      atom_enrichment_proposals: {
        Row: {
          batch_id: string
          confidence: number | null
          created_at: string
          diff: Json | null
          existing_atom_snapshot: Json | null
          explanation: string | null
          id: string
          inferred: boolean
          model_run_id: string | null
          normalizer_version: string | null
          prompt_version: string | null
          proposal_action: Database["public"]["Enums"]["atom_enrichment_proposal_action"]
          proposal_payload: Json
          rationale: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_comment: string | null
          source_hash: string | null
          source_id: string | null
          source_import_id: string | null
          source_record_id: string | null
          source_table: string | null
          source_type: string
          status: Database["public"]["Enums"]["atom_enrichment_proposal_status"]
          superseded_by_proposal_id: string | null
          target_atom_id: string | null
          target_atom_type: string
          target_entity_id: string | null
          target_entity_type: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          batch_id: string
          confidence?: number | null
          created_at?: string
          diff?: Json | null
          existing_atom_snapshot?: Json | null
          explanation?: string | null
          id?: string
          inferred?: boolean
          model_run_id?: string | null
          normalizer_version?: string | null
          prompt_version?: string | null
          proposal_action: Database["public"]["Enums"]["atom_enrichment_proposal_action"]
          proposal_payload?: Json
          rationale?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_comment?: string | null
          source_hash?: string | null
          source_id?: string | null
          source_import_id?: string | null
          source_record_id?: string | null
          source_table?: string | null
          source_type: string
          status?: Database["public"]["Enums"]["atom_enrichment_proposal_status"]
          superseded_by_proposal_id?: string | null
          target_atom_id?: string | null
          target_atom_type: string
          target_entity_id?: string | null
          target_entity_type?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          batch_id?: string
          confidence?: number | null
          created_at?: string
          diff?: Json | null
          existing_atom_snapshot?: Json | null
          explanation?: string | null
          id?: string
          inferred?: boolean
          model_run_id?: string | null
          normalizer_version?: string | null
          prompt_version?: string | null
          proposal_action?: Database["public"]["Enums"]["atom_enrichment_proposal_action"]
          proposal_payload?: Json
          rationale?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_comment?: string | null
          source_hash?: string | null
          source_id?: string | null
          source_import_id?: string | null
          source_record_id?: string | null
          source_table?: string | null
          source_type?: string
          status?: Database["public"]["Enums"]["atom_enrichment_proposal_status"]
          superseded_by_proposal_id?: string | null
          target_atom_id?: string | null
          target_atom_type?: string
          target_entity_id?: string | null
          target_entity_type?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "atom_enrichment_proposals_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "atom_enrichment_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "atom_enrichment_proposals_superseded_by_proposal_id_fkey"
            columns: ["superseded_by_proposal_id"]
            isOneToOne: false
            referencedRelation: "atom_enrichment_proposals"
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
          live_until: string | null
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
          live_until?: string | null
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
          live_until?: string | null
          merge_summary?: string | null
          primary_source?: string
          updated_at?: string
        }
        Relationships: []
      }
      career_atoms: {
        Row: {
          atom_class: string | null
          atom_kind: string
          atom_type: string | null
          attestation: string | null
          confidence: string
          content_en: string | null
          content_no: string | null
          created_at: string
          due_at: string | null
          evidence_atom_ids: string[]
          id: string
          is_active: boolean
          last_seen_at: string | null
          mangel_state: string | null
          parent_atom_id: string | null
          refreshed_at: string | null
          source_quote: string | null
          source_ref: string | null
          source_type: string
          stale_at: string | null
          state: string | null
          structured_data: Json
          target_position_id: string | null
          target_requirement_id: string | null
          updated_at: string
          user_confirmed: boolean
          user_id: string
          user_locked: boolean
          valid_from: string | null
          valid_to: string | null
          viktighet: number | null
        }
        Insert: {
          atom_class?: string | null
          atom_kind: string
          atom_type?: string | null
          attestation?: string | null
          confidence?: string
          content_en?: string | null
          content_no?: string | null
          created_at?: string
          due_at?: string | null
          evidence_atom_ids?: string[]
          id?: string
          is_active?: boolean
          last_seen_at?: string | null
          mangel_state?: string | null
          parent_atom_id?: string | null
          refreshed_at?: string | null
          source_quote?: string | null
          source_ref?: string | null
          source_type: string
          stale_at?: string | null
          state?: string | null
          structured_data?: Json
          target_position_id?: string | null
          target_requirement_id?: string | null
          updated_at?: string
          user_confirmed?: boolean
          user_id: string
          user_locked?: boolean
          valid_from?: string | null
          valid_to?: string | null
          viktighet?: number | null
        }
        Update: {
          atom_class?: string | null
          atom_kind?: string
          atom_type?: string | null
          attestation?: string | null
          confidence?: string
          content_en?: string | null
          content_no?: string | null
          created_at?: string
          due_at?: string | null
          evidence_atom_ids?: string[]
          id?: string
          is_active?: boolean
          last_seen_at?: string | null
          mangel_state?: string | null
          parent_atom_id?: string | null
          refreshed_at?: string | null
          source_quote?: string | null
          source_ref?: string | null
          source_type?: string
          stale_at?: string | null
          state?: string | null
          structured_data?: Json
          target_position_id?: string | null
          target_requirement_id?: string | null
          updated_at?: string
          user_confirmed?: boolean
          user_id?: string
          user_locked?: boolean
          valid_from?: string | null
          valid_to?: string | null
          viktighet?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "career_atoms_parent_atom_id_fkey"
            columns: ["parent_atom_id"]
            isOneToOne: false
            referencedRelation: "career_atoms"
            referencedColumns: ["id"]
          },
        ]
      }
      careerjet_identity_audit: {
        Row: {
          action: string
          after_jsonb: Json | null
          before_jsonb: Json | null
          created_at: string
          fencing_token: number | null
          id: string
          repair_run_id: string | null
          run_id: string | null
          source_posting_id: string | null
          thread_id: string | null
        }
        Insert: {
          action: string
          after_jsonb?: Json | null
          before_jsonb?: Json | null
          created_at?: string
          fencing_token?: number | null
          id?: string
          repair_run_id?: string | null
          run_id?: string | null
          source_posting_id?: string | null
          thread_id?: string | null
        }
        Update: {
          action?: string
          after_jsonb?: Json | null
          before_jsonb?: Json | null
          created_at?: string
          fencing_token?: number | null
          id?: string
          repair_run_id?: string | null
          run_id?: string | null
          source_posting_id?: string | null
          thread_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "careerjet_identity_audit_repair_run_id_fkey"
            columns: ["repair_run_id"]
            isOneToOne: false
            referencedRelation: "careerjet_identity_repair_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "careerjet_identity_audit_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "careerjet_sync_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "careerjet_identity_audit_source_posting_id_fkey"
            columns: ["source_posting_id"]
            isOneToOne: false
            referencedRelation: "source_postings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "careerjet_identity_audit_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "careerjet_source_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      careerjet_identity_repair_runs: {
        Row: {
          cursor_after_fingerprint: string | null
          finished_at: string | null
          id: string
          ids_adopted: number
          ids_failed: number
          ids_requested: number
          ids_reviewed: number
          ids_superseded: number
          ids_unprocessed: number
          meta: Json
          started_at: string
          status: string
          total_fingerprints: number
        }
        Insert: {
          cursor_after_fingerprint?: string | null
          finished_at?: string | null
          id?: string
          ids_adopted?: number
          ids_failed?: number
          ids_requested?: number
          ids_reviewed?: number
          ids_superseded?: number
          ids_unprocessed?: number
          meta?: Json
          started_at?: string
          status?: string
          total_fingerprints?: number
        }
        Update: {
          cursor_after_fingerprint?: string | null
          finished_at?: string | null
          id?: string
          ids_adopted?: number
          ids_failed?: number
          ids_requested?: number
          ids_reviewed?: number
          ids_superseded?: number
          ids_unprocessed?: number
          meta?: Json
          started_at?: string
          status?: string
          total_fingerprints?: number
        }
        Relationships: []
      }
      careerjet_identity_review: {
        Row: {
          evidence: Json
          identity_fingerprint: string | null
          opened_at: string
          reason: string
          resolved_at: string | null
          review_id: string
          status: string
          thread_id: string | null
        }
        Insert: {
          evidence?: Json
          identity_fingerprint?: string | null
          opened_at?: string
          reason: string
          resolved_at?: string | null
          review_id?: string
          status?: string
          thread_id?: string | null
        }
        Update: {
          evidence?: Json
          identity_fingerprint?: string | null
          opened_at?: string
          reason?: string
          resolved_at?: string | null
          review_id?: string
          status?: string
          thread_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "careerjet_identity_review_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "careerjet_source_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      careerjet_identity_review_candidates: {
        Row: {
          added_at: string
          review_id: string
          source_posting_id: string
        }
        Insert: {
          added_at?: string
          review_id: string
          source_posting_id: string
        }
        Update: {
          added_at?: string
          review_id?: string
          source_posting_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "careerjet_identity_review_candidates_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "careerjet_identity_review"
            referencedColumns: ["review_id"]
          },
          {
            foreignKeyName: "careerjet_identity_review_candidates_source_posting_id_fkey"
            columns: ["source_posting_id"]
            isOneToOne: false
            referencedRelation: "source_postings"
            referencedColumns: ["id"]
          },
        ]
      }
      careerjet_identity_review_observations: {
        Row: {
          id: string
          idempotency_key: string
          observed_at: string
          raw_payload: Json | null
          raw_url: string | null
          review_id: string
          sync_run_id: string | null
        }
        Insert: {
          id?: string
          idempotency_key: string
          observed_at?: string
          raw_payload?: Json | null
          raw_url?: string | null
          review_id: string
          sync_run_id?: string | null
        }
        Update: {
          id?: string
          idempotency_key?: string
          observed_at?: string
          raw_payload?: Json | null
          raw_url?: string | null
          review_id?: string
          sync_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "careerjet_identity_review_observations_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "careerjet_identity_review"
            referencedColumns: ["review_id"]
          },
          {
            foreignKeyName: "careerjet_identity_review_observations_sync_run_id_fkey"
            columns: ["sync_run_id"]
            isOneToOne: false
            referencedRelation: "careerjet_sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      careerjet_observation_aliases: {
        Row: {
          first_seen_at: string
          observation_id: string
          raw_url_hash: string
          raw_url_norm: string
          raw_url_sample: string
        }
        Insert: {
          first_seen_at?: string
          observation_id: string
          raw_url_hash: string
          raw_url_norm: string
          raw_url_sample: string
        }
        Update: {
          first_seen_at?: string
          observation_id?: string
          raw_url_hash?: string
          raw_url_norm?: string
          raw_url_sample?: string
        }
        Relationships: [
          {
            foreignKeyName: "careerjet_observation_aliases_observation_id_fkey"
            columns: ["observation_id"]
            isOneToOne: false
            referencedRelation: "careerjet_source_observations"
            referencedColumns: ["id"]
          },
        ]
      }
      careerjet_observation_terms: {
        Row: {
          cursor_term: string
          first_seen_at: string
          observation_id: string
          rank_in_term: number | null
        }
        Insert: {
          cursor_term: string
          first_seen_at?: string
          observation_id: string
          rank_in_term?: number | null
        }
        Update: {
          cursor_term?: string
          first_seen_at?: string
          observation_id?: string
          rank_in_term?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "careerjet_observation_terms_observation_id_fkey"
            columns: ["observation_id"]
            isOneToOne: false
            referencedRelation: "careerjet_source_observations"
            referencedColumns: ["id"]
          },
        ]
      }
      careerjet_search_terms: {
        Row: {
          active: boolean
          created_at: string
          id: string
          last_run_at: string | null
          locale: string
          location: string | null
          priority: number
          source: string
          term: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          last_run_at?: string | null
          locale?: string
          location?: string | null
          priority?: number
          source?: string
          term: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          last_run_at?: string | null
          locale?: string
          location?: string | null
          priority?: number
          source?: string
          term?: string
          updated_at?: string
        }
        Relationships: []
      }
      careerjet_source_observations: {
        Row: {
          alias_count: number
          classification: string
          id: string
          observed_at: string
          stable_content_hash: string | null
          sync_run_id: string
          term_count: number
          thread_id: string
          was_changed: boolean
        }
        Insert: {
          alias_count?: number
          classification: string
          id?: string
          observed_at?: string
          stable_content_hash?: string | null
          sync_run_id: string
          term_count?: number
          thread_id: string
          was_changed: boolean
        }
        Update: {
          alias_count?: number
          classification?: string
          id?: string
          observed_at?: string
          stable_content_hash?: string | null
          sync_run_id?: string
          term_count?: number
          thread_id?: string
          was_changed?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "careerjet_source_observations_sync_run_id_fkey"
            columns: ["sync_run_id"]
            isOneToOne: false
            referencedRelation: "careerjet_sync_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "careerjet_source_observations_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "careerjet_source_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      careerjet_source_threads: {
        Row: {
          created_at: string
          first_seen_run_id: string | null
          fp_version: number
          generation: number
          id: string
          identity_fingerprint: string
          keeper_source_posting_id: string
          last_seen_at: string | null
          last_seen_run_id: string | null
          stable_content_hash: string | null
          stable_content_hash_version: number
          state: string
          thread_key: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          first_seen_run_id?: string | null
          fp_version?: number
          generation?: number
          id?: string
          identity_fingerprint: string
          keeper_source_posting_id: string
          last_seen_at?: string | null
          last_seen_run_id?: string | null
          stable_content_hash?: string | null
          stable_content_hash_version?: number
          state?: string
          thread_key: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          first_seen_run_id?: string | null
          fp_version?: number
          generation?: number
          id?: string
          identity_fingerprint?: string
          keeper_source_posting_id?: string
          last_seen_at?: string | null
          last_seen_run_id?: string | null
          stable_content_hash?: string | null
          stable_content_hash_version?: number
          state?: string
          thread_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "careerjet_threads_first_run_fk"
            columns: ["first_seen_run_id"]
            isOneToOne: false
            referencedRelation: "careerjet_sync_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "careerjet_threads_keeper_fk"
            columns: ["keeper_source_posting_id"]
            isOneToOne: false
            referencedRelation: "source_postings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "careerjet_threads_last_run_fk"
            columns: ["last_seen_run_id"]
            isOneToOne: false
            referencedRelation: "careerjet_sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      careerjet_sync_runs: {
        Row: {
          api_errors: Json
          cursor_page: number | null
          cursor_term: string | null
          error_summary: string | null
          finished_at: string | null
          id: string
          meta: Json
          rows_expired: number
          rows_failed: number
          rows_fetched: number
          rows_reactivated: number
          rows_upserted: number
          started_at: string
          status: string
          terms_covered: number
        }
        Insert: {
          api_errors?: Json
          cursor_page?: number | null
          cursor_term?: string | null
          error_summary?: string | null
          finished_at?: string | null
          id?: string
          meta?: Json
          rows_expired?: number
          rows_failed?: number
          rows_fetched?: number
          rows_reactivated?: number
          rows_upserted?: number
          started_at?: string
          status?: string
          terms_covered?: number
        }
        Update: {
          api_errors?: Json
          cursor_page?: number | null
          cursor_term?: string | null
          error_summary?: string | null
          finished_at?: string | null
          id?: string
          meta?: Json
          rows_expired?: number
          rows_failed?: number
          rows_fetched?: number
          rows_reactivated?: number
          rows_upserted?: number
          started_at?: string
          status?: string
          terms_covered?: number
        }
        Relationships: []
      }
      careerjet_writer_leases: {
        Row: {
          acquired_at: string
          expires_at: string
          fencing_token: number
          heartbeat_at: string
          lease_name: string
          run_id: string
        }
        Insert: {
          acquired_at: string
          expires_at: string
          fencing_token: number
          heartbeat_at: string
          lease_name: string
          run_id: string
        }
        Update: {
          acquired_at?: string
          expires_at?: string
          fencing_token?: number
          heartbeat_at?: string
          lease_name?: string
          run_id?: string
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
          agg_career_development_score: number | null
          agg_culture_score: number | null
          agg_financial_stability_score: number | null
          agg_leadership_score: number | null
          agg_mission_score: number | null
          agg_overall_score: number | null
          agg_process_count: number
          agg_process_overall: number | null
          agg_process_q1: number | null
          agg_process_q2: number | null
          agg_process_q3: number | null
          agg_process_q4: number | null
          agg_process_q5: number | null
          agg_process_q6: number | null
          agg_rating_count: number | null
          agg_updated_at: string | null
          agg_work_environment_score: number | null
          ai_career_development_score: number | null
          ai_culture_score: number | null
          ai_dimension_notes: Json | null
          ai_financial_stability_score: number | null
          ai_leadership_score: number | null
          ai_mission_score: number | null
          ai_overall_score: number | null
          ai_rated_at: string | null
          ai_rating_notes: string | null
          ai_work_environment_score: number | null
          brreg_match_confidence: number | null
          brreg_match_source: string | null
          brreg_matched_at: string | null
          country: string | null
          created_at: string
          description: string | null
          domain: string | null
          employer_analysis_rated_at: string | null
          employer_analysis_source_updated_at: string | null
          employer_analysis_v2: Json | null
          employer_analysis_version: number | null
          financials: Json | null
          id: string
          industry: string | null
          name: string
          organisasjonsnummer: string | null
          ownership_type: string | null
          research_log: Json | null
          size_estimate: string | null
          updated_at: string
        }
        Insert: {
          agg_career_development_score?: number | null
          agg_culture_score?: number | null
          agg_financial_stability_score?: number | null
          agg_leadership_score?: number | null
          agg_mission_score?: number | null
          agg_overall_score?: number | null
          agg_process_count?: number
          agg_process_overall?: number | null
          agg_process_q1?: number | null
          agg_process_q2?: number | null
          agg_process_q3?: number | null
          agg_process_q4?: number | null
          agg_process_q5?: number | null
          agg_process_q6?: number | null
          agg_rating_count?: number | null
          agg_updated_at?: string | null
          agg_work_environment_score?: number | null
          ai_career_development_score?: number | null
          ai_culture_score?: number | null
          ai_dimension_notes?: Json | null
          ai_financial_stability_score?: number | null
          ai_leadership_score?: number | null
          ai_mission_score?: number | null
          ai_overall_score?: number | null
          ai_rated_at?: string | null
          ai_rating_notes?: string | null
          ai_work_environment_score?: number | null
          brreg_match_confidence?: number | null
          brreg_match_source?: string | null
          brreg_matched_at?: string | null
          country?: string | null
          created_at?: string
          description?: string | null
          domain?: string | null
          employer_analysis_rated_at?: string | null
          employer_analysis_source_updated_at?: string | null
          employer_analysis_v2?: Json | null
          employer_analysis_version?: number | null
          financials?: Json | null
          id?: string
          industry?: string | null
          name: string
          organisasjonsnummer?: string | null
          ownership_type?: string | null
          research_log?: Json | null
          size_estimate?: string | null
          updated_at?: string
        }
        Update: {
          agg_career_development_score?: number | null
          agg_culture_score?: number | null
          agg_financial_stability_score?: number | null
          agg_leadership_score?: number | null
          agg_mission_score?: number | null
          agg_overall_score?: number | null
          agg_process_count?: number
          agg_process_overall?: number | null
          agg_process_q1?: number | null
          agg_process_q2?: number | null
          agg_process_q3?: number | null
          agg_process_q4?: number | null
          agg_process_q5?: number | null
          agg_process_q6?: number | null
          agg_rating_count?: number | null
          agg_updated_at?: string | null
          agg_work_environment_score?: number | null
          ai_career_development_score?: number | null
          ai_culture_score?: number | null
          ai_dimension_notes?: Json | null
          ai_financial_stability_score?: number | null
          ai_leadership_score?: number | null
          ai_mission_score?: number | null
          ai_overall_score?: number | null
          ai_rated_at?: string | null
          ai_rating_notes?: string | null
          ai_work_environment_score?: number | null
          brreg_match_confidence?: number | null
          brreg_match_source?: string | null
          brreg_matched_at?: string | null
          country?: string | null
          created_at?: string
          description?: string | null
          domain?: string | null
          employer_analysis_rated_at?: string | null
          employer_analysis_source_updated_at?: string | null
          employer_analysis_v2?: Json | null
          employer_analysis_version?: number | null
          financials?: Json | null
          id?: string
          industry?: string | null
          name?: string
          organisasjonsnummer?: string | null
          ownership_type?: string | null
          research_log?: Json | null
          size_estimate?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      company_profile_atoms: {
        Row: {
          category: string
          company_id: string
          confidence_score: number | null
          created_at: string
          description: string | null
          dimension: string | null
          id: string
          inferred: boolean
          is_active: boolean
          label: string
          normalized_value: string | null
          refreshed_at: string | null
          source: string
          source_hash: string | null
          stale_at: string | null
          strength_score: number | null
          updated_at: string
        }
        Insert: {
          category: string
          company_id: string
          confidence_score?: number | null
          created_at?: string
          description?: string | null
          dimension?: string | null
          id?: string
          inferred?: boolean
          is_active?: boolean
          label: string
          normalized_value?: string | null
          refreshed_at?: string | null
          source?: string
          source_hash?: string | null
          stale_at?: string | null
          strength_score?: number | null
          updated_at?: string
        }
        Update: {
          category?: string
          company_id?: string
          confidence_score?: number | null
          created_at?: string
          description?: string | null
          dimension?: string | null
          id?: string
          inferred?: boolean
          is_active?: boolean
          label?: string
          normalized_value?: string | null
          refreshed_at?: string | null
          source?: string
          source_hash?: string | null
          stale_at?: string | null
          strength_score?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_profile_atoms_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_profile_atoms_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "employer_search_v1"
            referencedColumns: ["company_id"]
          },
        ]
      }
      company_signal_atoms: {
        Row: {
          company_id: string
          confidence_score: number | null
          created_at: string
          description: string | null
          expires_at: string | null
          id: string
          is_active: boolean
          label: string
          observed_at: string | null
          refreshed_at: string | null
          signal_strength: number | null
          signal_type: string
          source: string
          source_hash: string | null
          stale_at: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          confidence_score?: number | null
          created_at?: string
          description?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          label: string
          observed_at?: string | null
          refreshed_at?: string | null
          signal_strength?: number | null
          signal_type: string
          source?: string
          source_hash?: string | null
          stale_at?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          confidence_score?: number | null
          created_at?: string
          description?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          label?: string
          observed_at?: string | null
          refreshed_at?: string | null
          signal_strength?: number | null
          signal_type?: string
          source?: string
          source_hash?: string | null
          stale_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_signal_atoms_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_signal_atoms_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "employer_search_v1"
            referencedColumns: ["company_id"]
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
      cv_claim_attestation_events: {
        Row: {
          attestation_id: string
          created_at: string
          detail: Json
          event_kind: string
          id: string
          user_id: string
        }
        Insert: {
          attestation_id: string
          created_at?: string
          detail?: Json
          event_kind: string
          id?: string
          user_id: string
        }
        Update: {
          attestation_id?: string
          created_at?: string
          detail?: Json
          event_kind?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cv_claim_attestation_events_attestation_id_fkey"
            columns: ["attestation_id"]
            isOneToOne: false
            referencedRelation: "cv_claim_attestations"
            referencedColumns: ["id"]
          },
        ]
      }
      cv_claim_attestations: {
        Row: {
          attested_at: string
          attested_by_user_id: string
          attested_claim_hash: string
          attested_claim_text: string
          claim_id: string
          created_at: string
          document_id: string
          external_document_available: boolean
          external_source_name: string | null
          external_source_year: number | null
          id: string
          invalidated_at: string | null
          invalidated_reason: string | null
          note: string | null
          updated_at: string
          withdrawn_at: string | null
          withdrawn_reason: string | null
        }
        Insert: {
          attested_at?: string
          attested_by_user_id: string
          attested_claim_hash: string
          attested_claim_text: string
          claim_id: string
          created_at?: string
          document_id: string
          external_document_available?: boolean
          external_source_name?: string | null
          external_source_year?: number | null
          id?: string
          invalidated_at?: string | null
          invalidated_reason?: string | null
          note?: string | null
          updated_at?: string
          withdrawn_at?: string | null
          withdrawn_reason?: string | null
        }
        Update: {
          attested_at?: string
          attested_by_user_id?: string
          attested_claim_hash?: string
          attested_claim_text?: string
          claim_id?: string
          created_at?: string
          document_id?: string
          external_document_available?: boolean
          external_source_name?: string | null
          external_source_year?: number | null
          id?: string
          invalidated_at?: string | null
          invalidated_reason?: string | null
          note?: string | null
          updated_at?: string
          withdrawn_at?: string | null
          withdrawn_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cv_claim_attestations_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      cv_document_blocks: {
        Row: {
          block_id: string
          claim_ids: string[]
          created_at: string
          document_id: string
          id: string
          ordinal: number
          requirement_atom_ids: string[]
          section: string
          source_snapshot_hash: string
          supporting_atom_ids: string[]
          text: string
          user_id: string
        }
        Insert: {
          block_id: string
          claim_ids?: string[]
          created_at?: string
          document_id: string
          id?: string
          ordinal?: number
          requirement_atom_ids?: string[]
          section: string
          source_snapshot_hash: string
          supporting_atom_ids?: string[]
          text: string
          user_id: string
        }
        Update: {
          block_id?: string
          claim_ids?: string[]
          created_at?: string
          document_id?: string
          id?: string
          ordinal?: number
          requirement_atom_ids?: string[]
          section?: string
          source_snapshot_hash?: string
          supporting_atom_ids?: string[]
          text?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cv_document_blocks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      cv_document_claims: {
        Row: {
          block_id: string
          claim_id: string
          claim_type: string
          created_at: string
          document_id: string
          id: string
          supporting_atom_ids: string[]
          user_id: string
          value: string
          verification: string
        }
        Insert: {
          block_id: string
          claim_id: string
          claim_type: string
          created_at?: string
          document_id: string
          id?: string
          supporting_atom_ids?: string[]
          user_id: string
          value: string
          verification?: string
        }
        Update: {
          block_id?: string
          claim_id?: string
          claim_type?: string
          created_at?: string
          document_id?: string
          id?: string
          supporting_atom_ids?: string[]
          user_id?: string
          value?: string
          verification?: string
        }
        Relationships: [
          {
            foreignKeyName: "cv_document_claims_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      cv_generation_jobs: {
        Row: {
          attempt_count: number
          created_at: string
          current_step: string | null
          document_group_id: string
          document_id: string | null
          error_code: string | null
          finished_at: string | null
          id: string
          input_payload: Json
          job_kind: string
          last_error: string | null
          lease_expires_at: string | null
          lease_seconds: number
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          model_run_id: string | null
          opportunity_id: string | null
          priority: number
          profile_id: string | null
          result_payload: Json | null
          rewrite_count: number
          run_after: string
          status: string
          step_budget_ms: number
          step_state: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          current_step?: string | null
          document_group_id: string
          document_id?: string | null
          error_code?: string | null
          finished_at?: string | null
          id?: string
          input_payload?: Json
          job_kind: string
          last_error?: string | null
          lease_expires_at?: string | null
          lease_seconds?: number
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          model_run_id?: string | null
          opportunity_id?: string | null
          priority?: number
          profile_id?: string | null
          result_payload?: Json | null
          rewrite_count?: number
          run_after?: string
          status?: string
          step_budget_ms?: number
          step_state?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          current_step?: string | null
          document_group_id?: string
          document_id?: string | null
          error_code?: string | null
          finished_at?: string | null
          id?: string
          input_payload?: Json
          job_kind?: string
          last_error?: string | null
          lease_expires_at?: string | null
          lease_seconds?: number
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          model_run_id?: string | null
          opportunity_id?: string | null
          priority?: number
          profile_id?: string | null
          result_payload?: Json | null
          rewrite_count?: number
          run_after?: string
          status?: string
          step_budget_ms?: number
          step_state?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cv_generation_jobs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cv_generation_jobs_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "user_opportunities"
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
      cv_parse_candidates: {
        Row: {
          content_en: string | null
          content_no: string | null
          created_at: string
          dedupe_key: string | null
          id: string
          import_id: string
          local_ref: string
          parent_local_ref: string | null
          parse_confidence: number | null
          promoted_atom_id: string | null
          question_ref: string | null
          rejected_reason: string | null
          resolved_atom_type: string | null
          reviewed_at: string | null
          source_quote: string | null
          source_ref: string | null
          source_type: string
          status: string
          structured_data: Json
          suggested_atom_type: string
          suggested_from_category: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          content_en?: string | null
          content_no?: string | null
          created_at?: string
          dedupe_key?: string | null
          id?: string
          import_id: string
          local_ref: string
          parent_local_ref?: string | null
          parse_confidence?: number | null
          promoted_atom_id?: string | null
          question_ref?: string | null
          rejected_reason?: string | null
          resolved_atom_type?: string | null
          reviewed_at?: string | null
          source_quote?: string | null
          source_ref?: string | null
          source_type: string
          status?: string
          structured_data?: Json
          suggested_atom_type: string
          suggested_from_category?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          content_en?: string | null
          content_no?: string | null
          created_at?: string
          dedupe_key?: string | null
          id?: string
          import_id?: string
          local_ref?: string
          parent_local_ref?: string | null
          parse_confidence?: number | null
          promoted_atom_id?: string | null
          question_ref?: string | null
          rejected_reason?: string | null
          resolved_atom_type?: string | null
          reviewed_at?: string | null
          source_quote?: string | null
          source_ref?: string | null
          source_type?: string
          status?: string
          structured_data?: Json
          suggested_atom_type?: string
          suggested_from_category?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cv_parse_candidates_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "cv_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cv_parse_candidates_promoted_atom_id_fkey"
            columns: ["promoted_atom_id"]
            isOneToOne: false
            referencedRelation: "career_atoms"
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
          cv_variant: string | null
          deleted_at: string | null
          document_group_id: string
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
          opportunity_id: string | null
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
          cv_variant?: string | null
          deleted_at?: string | null
          document_group_id?: string
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
          opportunity_id?: string | null
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
          cv_variant?: string | null
          deleted_at?: string | null
          document_group_id?: string
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
          opportunity_id?: string | null
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
        Relationships: [
          {
            foreignKeyName: "documents_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications_with_urgency"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_document_group_id_fkey"
            columns: ["document_group_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "user_opportunities"
            referencedColumns: ["id"]
          },
        ]
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
      employer_analysis_jobs: {
        Row: {
          artifact_document_id: string | null
          company_id: string
          completed_at: string | null
          created_at: string
          current_step: string | null
          error_message: string | null
          id: string
          progress_percent: number
          retry_after_at: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["employer_analysis_job_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          artifact_document_id?: string | null
          company_id: string
          completed_at?: string | null
          created_at?: string
          current_step?: string | null
          error_message?: string | null
          id?: string
          progress_percent?: number
          retry_after_at?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["employer_analysis_job_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          artifact_document_id?: string | null
          company_id?: string
          completed_at?: string | null
          created_at?: string
          current_step?: string | null
          error_message?: string | null
          id?: string
          progress_percent?: number
          retry_after_at?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["employer_analysis_job_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employer_analysis_jobs_artifact_document_id_fkey"
            columns: ["artifact_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employer_analysis_jobs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employer_analysis_jobs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "employer_search_v1"
            referencedColumns: ["company_id"]
          },
        ]
      }
      employer_analysis_model_run_reviews: {
        Row: {
          analysis_quality: number
          created_at: string
          factual_accuracy: number
          financial_quality: number
          notes: string | null
          reviewer_id: string
          run_id: string
          scope_precision: number
          source_quality: number
          updated_at: string
        }
        Insert: {
          analysis_quality: number
          created_at?: string
          factual_accuracy: number
          financial_quality: number
          notes?: string | null
          reviewer_id: string
          run_id: string
          scope_precision: number
          source_quality: number
          updated_at?: string
        }
        Update: {
          analysis_quality?: number
          created_at?: string
          factual_accuracy?: number
          financial_quality?: number
          notes?: string | null
          reviewer_id?: string
          run_id?: string
          scope_precision?: number
          source_quality?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employer_analysis_model_run_reviews_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "employer_analysis_model_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      employer_analysis_model_runs: {
        Row: {
          analysis_duration_ms: number | null
          analysis_input_tokens: number | null
          analysis_model: string
          analysis_output_tokens: number | null
          analysis_provider: string
          benchmark_group_id: string | null
          company_id: string
          cost_estimate_complete: boolean
          created_at: string
          error_summary: string | null
          estimated_cost_usd: number | null
          financial_fallback_used: boolean
          finished_at: string | null
          id: string
          pricing_snapshot_date: string | null
          requested_by: string | null
          research_duration_ms: number | null
          research_input_tokens: number | null
          research_model: string
          research_output_tokens: number | null
          research_provider: string
          result_snapshot: Json | null
          run_mode: string
          scored_ai_dimensions: number | null
          scored_employer_dimensions: number | null
          source_count: number | null
          started_at: string
          status: string
          web_search_requests: number | null
        }
        Insert: {
          analysis_duration_ms?: number | null
          analysis_input_tokens?: number | null
          analysis_model: string
          analysis_output_tokens?: number | null
          analysis_provider: string
          benchmark_group_id?: string | null
          company_id: string
          cost_estimate_complete?: boolean
          created_at?: string
          error_summary?: string | null
          estimated_cost_usd?: number | null
          financial_fallback_used?: boolean
          finished_at?: string | null
          id?: string
          pricing_snapshot_date?: string | null
          requested_by?: string | null
          research_duration_ms?: number | null
          research_input_tokens?: number | null
          research_model: string
          research_output_tokens?: number | null
          research_provider: string
          result_snapshot?: Json | null
          run_mode?: string
          scored_ai_dimensions?: number | null
          scored_employer_dimensions?: number | null
          source_count?: number | null
          started_at?: string
          status?: string
          web_search_requests?: number | null
        }
        Update: {
          analysis_duration_ms?: number | null
          analysis_input_tokens?: number | null
          analysis_model?: string
          analysis_output_tokens?: number | null
          analysis_provider?: string
          benchmark_group_id?: string | null
          company_id?: string
          cost_estimate_complete?: boolean
          created_at?: string
          error_summary?: string | null
          estimated_cost_usd?: number | null
          financial_fallback_used?: boolean
          finished_at?: string | null
          id?: string
          pricing_snapshot_date?: string | null
          requested_by?: string | null
          research_duration_ms?: number | null
          research_input_tokens?: number | null
          research_model?: string
          research_output_tokens?: number | null
          research_provider?: string
          result_snapshot?: Json | null
          run_mode?: string
          scored_ai_dimensions?: number | null
          scored_employer_dimensions?: number | null
          source_count?: number | null
          started_at?: string
          status?: string
          web_search_requests?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "employer_analysis_model_runs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employer_analysis_model_runs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "employer_search_v1"
            referencedColumns: ["company_id"]
          },
        ]
      }
      employer_analysis_weight_profiles: {
        Row: {
          ai_weights: Json
          created_at: string
          created_by: string | null
          employer_weights: Json
          id: string
          is_active: boolean
          note: string | null
          profile_key: string
          version: number
        }
        Insert: {
          ai_weights: Json
          created_at?: string
          created_by?: string | null
          employer_weights: Json
          id?: string
          is_active?: boolean
          note?: string | null
          profile_key?: string
          version: number
        }
        Update: {
          ai_weights?: Json
          created_at?: string
          created_by?: string | null
          employer_weights?: Json
          id?: string
          is_active?: boolean
          note?: string | null
          profile_key?: string
          version?: number
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
      job_match_evaluations: {
        Row: {
          canonical_opportunity_id: string | null
          concerns: string | null
          created_at: string
          id: string
          job_input_hash: string | null
          listing_id: string | null
          listing_status_id: string | null
          match_highlights: string | null
          model: string | null
          previous_result: Json
          profile_input_hash: string | null
          reasoning: string | null
          requirement_summary: Json
          row_kind: string
          score: number | null
          score_version: string
          screening_reasons: Json
          screening_status: string
          user_id: string
          user_opportunity_id: string | null
        }
        Insert: {
          canonical_opportunity_id?: string | null
          concerns?: string | null
          created_at?: string
          id?: string
          job_input_hash?: string | null
          listing_id?: string | null
          listing_status_id?: string | null
          match_highlights?: string | null
          model?: string | null
          previous_result?: Json
          profile_input_hash?: string | null
          reasoning?: string | null
          requirement_summary?: Json
          row_kind: string
          score?: number | null
          score_version: string
          screening_reasons?: Json
          screening_status: string
          user_id: string
          user_opportunity_id?: string | null
        }
        Update: {
          canonical_opportunity_id?: string | null
          concerns?: string | null
          created_at?: string
          id?: string
          job_input_hash?: string | null
          listing_id?: string | null
          listing_status_id?: string | null
          match_highlights?: string | null
          model?: string | null
          previous_result?: Json
          profile_input_hash?: string | null
          reasoning?: string | null
          requirement_summary?: Json
          row_kind?: string
          score?: number | null
          score_version?: string
          screening_reasons?: Json
          screening_status?: string
          user_id?: string
          user_opportunity_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_match_evaluations_canonical_opportunity_id_fkey"
            columns: ["canonical_opportunity_id"]
            isOneToOne: false
            referencedRelation: "canonical_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_match_evaluations_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "job_listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_match_evaluations_listing_status_id_fkey"
            columns: ["listing_status_id"]
            isOneToOne: false
            referencedRelation: "user_job_listing_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_match_evaluations_user_opportunity_id_fkey"
            columns: ["user_opportunity_id"]
            isOneToOne: false
            referencedRelation: "user_opportunities"
            referencedColumns: ["id"]
          },
        ]
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
      match_assessments: {
        Row: {
          apply_recommendation_score: number | null
          assessment_type: string
          company_id: string | null
          created_at: string
          evidence_strength_score: number | null
          expires_at: string | null
          generated_at: string | null
          generated_by: string | null
          id: string
          listing_id: string | null
          match_band: string | null
          opportunity_id: string | null
          overall_match_score: number | null
          positioning_score: number | null
          reasoning: Json
          recommendation_summary: string | null
          source: string
          status: string
          summary: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          apply_recommendation_score?: number | null
          assessment_type: string
          company_id?: string | null
          created_at?: string
          evidence_strength_score?: number | null
          expires_at?: string | null
          generated_at?: string | null
          generated_by?: string | null
          id?: string
          listing_id?: string | null
          match_band?: string | null
          opportunity_id?: string | null
          overall_match_score?: number | null
          positioning_score?: number | null
          reasoning?: Json
          recommendation_summary?: string | null
          source?: string
          status?: string
          summary?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          apply_recommendation_score?: number | null
          assessment_type?: string
          company_id?: string | null
          created_at?: string
          evidence_strength_score?: number | null
          expires_at?: string | null
          generated_at?: string | null
          generated_by?: string | null
          id?: string
          listing_id?: string | null
          match_band?: string | null
          opportunity_id?: string | null
          overall_match_score?: number | null
          positioning_score?: number | null
          reasoning?: Json
          recommendation_summary?: string | null
          source?: string
          status?: string
          summary?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_assessments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_assessments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "employer_search_v1"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "match_assessments_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "job_listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_assessments_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "canonical_opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      match_dimension_assessments: {
        Row: {
          assessment_id: string
          created_at: string
          dimension: string
          evidence_strength_score: number | null
          id: string
          inferred_requirements: Json
          market_alignment_score: number | null
          matched_evidence_atoms: Json
          matched_preference_atoms: Json
          missing_evidence_atoms: Json
          overall_dimension_score: number | null
          preference_alignment_score: number | null
          reasoning: string | null
          recommendation: string | null
          score_band: string | null
          updated_at: string
        }
        Insert: {
          assessment_id: string
          created_at?: string
          dimension: string
          evidence_strength_score?: number | null
          id?: string
          inferred_requirements?: Json
          market_alignment_score?: number | null
          matched_evidence_atoms?: Json
          matched_preference_atoms?: Json
          missing_evidence_atoms?: Json
          overall_dimension_score?: number | null
          preference_alignment_score?: number | null
          reasoning?: string | null
          recommendation?: string | null
          score_band?: string | null
          updated_at?: string
        }
        Update: {
          assessment_id?: string
          created_at?: string
          dimension?: string
          evidence_strength_score?: number | null
          id?: string
          inferred_requirements?: Json
          market_alignment_score?: number | null
          matched_evidence_atoms?: Json
          matched_preference_atoms?: Json
          missing_evidence_atoms?: Json
          overall_dimension_score?: number | null
          preference_alignment_score?: number | null
          reasoning?: string | null
          recommendation?: string | null
          score_band?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_dimension_assessments_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "match_assessments"
            referencedColumns: ["id"]
          },
        ]
      }
      nav_repair_runs: {
        Row: {
          batches_processed: number
          created_at: string
          cursor_after_external_id: string
          finished_at: string | null
          id: string
          ids_found: number
          ids_missing: number
          ids_requested: number
          last_error: string | null
          meta: Json
          rows_failed: number
          rows_merged: number
          rows_noop: number
          rows_stale_ignored: number
          started_at: string
          status: string
          total_target_rows: number | null
          updated_at: string
        }
        Insert: {
          batches_processed?: number
          created_at?: string
          cursor_after_external_id?: string
          finished_at?: string | null
          id?: string
          ids_found?: number
          ids_missing?: number
          ids_requested?: number
          last_error?: string | null
          meta?: Json
          rows_failed?: number
          rows_merged?: number
          rows_noop?: number
          rows_stale_ignored?: number
          started_at?: string
          status?: string
          total_target_rows?: number | null
          updated_at?: string
        }
        Update: {
          batches_processed?: number
          created_at?: string
          cursor_after_external_id?: string
          finished_at?: string | null
          id?: string
          ids_found?: number
          ids_missing?: number
          ids_requested?: number
          last_error?: string | null
          meta?: Json
          rows_failed?: number
          rows_merged?: number
          rows_noop?: number
          rows_stale_ignored?: number
          started_at?: string
          status?: string
          total_target_rows?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      nav_sync_runs: {
        Row: {
          error_summary: string | null
          expired: number
          fetched: number
          finished_at: string | null
          id: string
          matched_user_opps: number
          meta: Json
          reactivated: number
          scored: number
          started_at: string
          upserted: number
        }
        Insert: {
          error_summary?: string | null
          expired?: number
          fetched?: number
          finished_at?: string | null
          id?: string
          matched_user_opps?: number
          meta?: Json
          reactivated?: number
          scored?: number
          started_at?: string
          upserted?: number
        }
        Update: {
          error_summary?: string | null
          expired?: number
          fetched?: number
          finished_at?: string | null
          id?: string
          matched_user_opps?: number
          meta?: Json
          reactivated?: number
          scored?: number
          started_at?: string
          upserted?: number
        }
        Relationships: []
      }
      nav_target_writer_leases: {
        Row: {
          acquired_at: string
          expires_at: string
          heartbeat_at: string
          lease_name: string
          mode: string
          run_id: string
        }
        Insert: {
          acquired_at?: string
          expires_at: string
          heartbeat_at?: string
          lease_name: string
          mode: string
          run_id: string
        }
        Update: {
          acquired_at?: string
          expires_at?: string
          heartbeat_at?: string
          lease_name?: string
          mode?: string
          run_id?: string
        }
        Relationships: []
      }
      next_steps: {
        Row: {
          application_id: string
          completed: boolean
          completed_at: string | null
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          priority: Database["public"]["Enums"]["priority_level"] | null
          title: string
        }
        Insert: {
          application_id: string
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["priority_level"] | null
          title: string
        }
        Update: {
          application_id?: string
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["priority_level"] | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "next_steps_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "next_steps_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications_with_urgency"
            referencedColumns: ["id"]
          },
        ]
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
      opportunity_requirement_atoms: {
        Row: {
          category: string
          confidence_score: number | null
          created_at: string
          description: string | null
          dimension: string | null
          evidence_excerpt: string | null
          id: string
          importance_score: number | null
          inferred: boolean
          is_active: boolean
          label: string
          listing_id: string | null
          normalized_value: string | null
          opportunity_id: string | null
          parser_version: string | null
          refreshed_at: string | null
          requirement_level: string | null
          source: string
          source_field: string | null
          source_hash: string | null
          stale_at: string | null
          updated_at: string
        }
        Insert: {
          category: string
          confidence_score?: number | null
          created_at?: string
          description?: string | null
          dimension?: string | null
          evidence_excerpt?: string | null
          id?: string
          importance_score?: number | null
          inferred?: boolean
          is_active?: boolean
          label: string
          listing_id?: string | null
          normalized_value?: string | null
          opportunity_id?: string | null
          parser_version?: string | null
          refreshed_at?: string | null
          requirement_level?: string | null
          source?: string
          source_field?: string | null
          source_hash?: string | null
          stale_at?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          confidence_score?: number | null
          created_at?: string
          description?: string | null
          dimension?: string | null
          evidence_excerpt?: string | null
          id?: string
          importance_score?: number | null
          inferred?: boolean
          is_active?: boolean
          label?: string
          listing_id?: string | null
          normalized_value?: string | null
          opportunity_id?: string | null
          parser_version?: string | null
          refreshed_at?: string | null
          requirement_level?: string | null
          source?: string
          source_field?: string | null
          source_hash?: string | null
          stale_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_requirement_atoms_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "job_listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_requirement_atoms_opportunity_id_fkey"
            columns: ["opportunity_id"]
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
      ops_alert_state: {
        Row: {
          alert_key: string
          details: Json
          first_seen_at: string
          last_notified_at: string | null
          last_seen_at: string
          notify_count: number
          resolved_at: string | null
          severity: string
          source: string
          title: string
          updated_at: string
        }
        Insert: {
          alert_key: string
          details?: Json
          first_seen_at?: string
          last_notified_at?: string | null
          last_seen_at?: string
          notify_count?: number
          resolved_at?: string | null
          severity?: string
          source: string
          title: string
          updated_at?: string
        }
        Update: {
          alert_key?: string
          details?: Json
          first_seen_at?: string
          last_notified_at?: string | null
          last_seen_at?: string
          notify_count?: number
          resolved_at?: string | null
          severity?: string
          source?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      ops_heartbeat: {
        Row: {
          details: Json
          last_beat_at: string
          name: string
        }
        Insert: {
          details?: Json
          last_beat_at?: string
          name: string
        }
        Update: {
          details?: Json
          last_beat_at?: string
          name?: string
        }
        Relationships: []
      }
      positioning_recommendations: {
        Row: {
          assessment_id: string
          category: string
          created_at: string
          description: string
          effort_score: number | null
          generated_by: string | null
          id: string
          impact_score: number | null
          priority_score: number | null
          source_dimension: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          assessment_id: string
          category: string
          created_at?: string
          description: string
          effort_score?: number | null
          generated_by?: string | null
          id?: string
          impact_score?: number | null
          priority_score?: number | null
          source_dimension?: string | null
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          assessment_id?: string
          category?: string
          created_at?: string
          description?: string
          effort_score?: number | null
          generated_by?: string | null
          id?: string
          impact_score?: number | null
          priority_score?: number | null
          source_dimension?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "positioning_recommendations_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "match_assessments"
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
          preferred_engagement_types: string[]
          preferred_locations: string[] | null
          preferred_work_extents: string[]
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
          preferred_engagement_types?: string[]
          preferred_locations?: string[] | null
          preferred_work_extents?: string[]
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
          preferred_engagement_types?: string[]
          preferred_locations?: string[] | null
          preferred_work_extents?: string[]
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
      respondent_profile: {
        Row: {
          candidate_focus: string | null
          created_at: string
          id: string
          industries: string[]
          respondent_type: string
          response_id: string
          sector: string | null
          seniority_levels: string[]
          years_experience: string | null
        }
        Insert: {
          candidate_focus?: string | null
          created_at?: string
          id?: string
          industries?: string[]
          respondent_type: string
          response_id: string
          sector?: string | null
          seniority_levels?: string[]
          years_experience?: string | null
        }
        Update: {
          candidate_focus?: string | null
          created_at?: string
          id?: string
          industries?: string[]
          respondent_type?: string
          response_id?: string
          sector?: string | null
          seniority_levels?: string[]
          years_experience?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "respondent_profile_response_id_fkey"
            columns: ["response_id"]
            isOneToOne: true
            referencedRelation: "survey_responses"
            referencedColumns: ["id"]
          },
        ]
      }
      result_access_signups: {
        Row: {
          access_granted_at: string | null
          access_token: string | null
          created_at: string
          email: string
          id: string
          name: string | null
          version_id: string | null
        }
        Insert: {
          access_granted_at?: string | null
          access_token?: string | null
          created_at?: string
          email: string
          id?: string
          name?: string | null
          version_id?: string | null
        }
        Update: {
          access_granted_at?: string | null
          access_token?: string | null
          created_at?: string
          email?: string
          id?: string
          name?: string | null
          version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "result_access_signups_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "survey_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      result_sections: {
        Row: {
          created_at: string
          description: string | null
          id: string
          key: string
          sort_order: number
          title: string
          version_id: string | null
          visibility_level: Database["public"]["Enums"]["survey_visibility"]
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          key: string
          sort_order?: number
          title: string
          version_id?: string | null
          visibility_level?: Database["public"]["Enums"]["survey_visibility"]
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          key?: string
          sort_order?: number
          title?: string
          version_id?: string | null
          visibility_level?: Database["public"]["Enums"]["survey_visibility"]
        }
        Relationships: [
          {
            foreignKeyName: "result_sections_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "survey_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      source_postings: {
        Row: {
          company: string | null
          created_at: string
          description_excerpt: string | null
          display_url: string
          engagement_type: string | null
          expired_at: string | null
          id: string
          identity_fingerprint: string
          identity_fp_version: number | null
          identity_resolved_at: string | null
          identity_role: string | null
          identity_superseded_by_source_posting_id: string | null
          identity_thread_id: string | null
          last_seen_at: string | null
          listing_id: string | null
          location: string | null
          posting_status: string
          published_at: string | null
          raw_payload: Json | null
          raw_url: string
          reactivated_at: string | null
          source: string
          source_event_id: string | null
          source_event_version: string | null
          source_external_id: string
          source_payload_hash: string | null
          title: string | null
          updated_at: string
          work_extent: string | null
        }
        Insert: {
          company?: string | null
          created_at?: string
          description_excerpt?: string | null
          display_url: string
          engagement_type?: string | null
          expired_at?: string | null
          id?: string
          identity_fingerprint: string
          identity_fp_version?: number | null
          identity_resolved_at?: string | null
          identity_role?: string | null
          identity_superseded_by_source_posting_id?: string | null
          identity_thread_id?: string | null
          last_seen_at?: string | null
          listing_id?: string | null
          location?: string | null
          posting_status?: string
          published_at?: string | null
          raw_payload?: Json | null
          raw_url: string
          reactivated_at?: string | null
          source: string
          source_event_id?: string | null
          source_event_version?: string | null
          source_external_id: string
          source_payload_hash?: string | null
          title?: string | null
          updated_at?: string
          work_extent?: string | null
        }
        Update: {
          company?: string | null
          created_at?: string
          description_excerpt?: string | null
          display_url?: string
          engagement_type?: string | null
          expired_at?: string | null
          id?: string
          identity_fingerprint?: string
          identity_fp_version?: number | null
          identity_resolved_at?: string | null
          identity_role?: string | null
          identity_superseded_by_source_posting_id?: string | null
          identity_thread_id?: string | null
          last_seen_at?: string | null
          listing_id?: string | null
          location?: string | null
          posting_status?: string
          published_at?: string | null
          raw_payload?: Json | null
          raw_url?: string
          reactivated_at?: string | null
          source?: string
          source_event_id?: string | null
          source_event_version?: string | null
          source_external_id?: string
          source_payload_hash?: string | null
          title?: string | null
          updated_at?: string
          work_extent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "source_postings_identity_superseded_fk"
            columns: ["identity_superseded_by_source_posting_id"]
            isOneToOne: false
            referencedRelation: "source_postings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_postings_identity_thread_fk"
            columns: ["identity_thread_id"]
            isOneToOne: false
            referencedRelation: "careerjet_source_threads"
            referencedColumns: ["id"]
          },
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
      survey_answers: {
        Row: {
          admin_note: string | null
          answer_value: Json
          created_at: string
          id: string
          is_flagged: boolean
          is_full_quote_approved: boolean
          is_public_quote_approved: boolean
          question_id: string
          response_id: string
          text_answer: string | null
        }
        Insert: {
          admin_note?: string | null
          answer_value: Json
          created_at?: string
          id?: string
          is_flagged?: boolean
          is_full_quote_approved?: boolean
          is_public_quote_approved?: boolean
          question_id: string
          response_id: string
          text_answer?: string | null
        }
        Update: {
          admin_note?: string | null
          answer_value?: Json
          created_at?: string
          id?: string
          is_flagged?: boolean
          is_full_quote_approved?: boolean
          is_public_quote_approved?: boolean
          question_id?: string
          response_id?: string
          text_answer?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "survey_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "survey_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_answers_response_id_fkey"
            columns: ["response_id"]
            isOneToOne: false
            referencedRelation: "survey_responses"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_questions: {
        Row: {
          category: string | null
          created_at: string
          helper_text: string | null
          id: string
          is_active: boolean
          is_full_result_enabled: boolean
          is_public_result_enabled: boolean
          is_required: boolean
          max_choices: number | null
          options: Json
          question_text: string
          question_type: Database["public"]["Enums"]["survey_question_type"]
          scale_max: number | null
          scale_max_label: string | null
          scale_mid_label: string | null
          scale_min: number | null
          scale_min_label: string | null
          sort_order: number
          updated_at: string
          version_id: string
          visibility_level: Database["public"]["Enums"]["survey_visibility"]
        }
        Insert: {
          category?: string | null
          created_at?: string
          helper_text?: string | null
          id?: string
          is_active?: boolean
          is_full_result_enabled?: boolean
          is_public_result_enabled?: boolean
          is_required?: boolean
          max_choices?: number | null
          options?: Json
          question_text: string
          question_type: Database["public"]["Enums"]["survey_question_type"]
          scale_max?: number | null
          scale_max_label?: string | null
          scale_mid_label?: string | null
          scale_min?: number | null
          scale_min_label?: string | null
          sort_order?: number
          updated_at?: string
          version_id: string
          visibility_level?: Database["public"]["Enums"]["survey_visibility"]
        }
        Update: {
          category?: string | null
          created_at?: string
          helper_text?: string | null
          id?: string
          is_active?: boolean
          is_full_result_enabled?: boolean
          is_public_result_enabled?: boolean
          is_required?: boolean
          max_choices?: number | null
          options?: Json
          question_text?: string
          question_type?: Database["public"]["Enums"]["survey_question_type"]
          scale_max?: number | null
          scale_max_label?: string | null
          scale_mid_label?: string | null
          scale_min?: number | null
          scale_min_label?: string | null
          sort_order?: number
          updated_at?: string
          version_id?: string
          visibility_level?: Database["public"]["Enums"]["survey_visibility"]
        }
        Relationships: [
          {
            foreignKeyName: "survey_questions_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "survey_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_responses: {
        Row: {
          created_at: string
          id: string
          submission_hash: string | null
          submitted_at: string
          user_agent: string | null
          version_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          submission_hash?: string | null
          submitted_at?: string
          user_agent?: string | null
          version_id: string
        }
        Update: {
          created_at?: string
          id?: string
          submission_hash?: string | null
          submitted_at?: string
          user_agent?: string | null
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "survey_responses_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "survey_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_versions: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          notes: string | null
          slug: string
          title: string
          updated_at: string
          version_number: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          slug: string
          title: string
          updated_at?: string
          version_number?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          slug?: string
          title?: string
          updated_at?: string
          version_number?: number
        }
        Relationships: []
      }
      user_career_profiles: {
        Row: {
          career_stage: string | null
          compensation_importance: number | null
          completeness_score: number | null
          created_at: string
          desired_industries: string[] | null
          desired_role_types: string[] | null
          dimension_weights: Json
          id: string
          innovation_importance: number | null
          last_ai_profile_review_at: string | null
          leadership_ambition: number | null
          leadership_level: string | null
          mission_importance: number | null
          preferred_company_sizes: string[] | null
          preferred_locations: string[] | null
          preferred_work_styles: string[] | null
          primary_industry: string | null
          profile_intent: string | null
          remote_preference: string | null
          salary_expectation_max: number | null
          salary_expectation_min: number | null
          stability_vs_growth: number | null
          sustainability_importance: number | null
          travel_preference: string | null
          updated_at: string
          user_id: string
          work_life_balance_importance: number | null
          years_experience: number | null
        }
        Insert: {
          career_stage?: string | null
          compensation_importance?: number | null
          completeness_score?: number | null
          created_at?: string
          desired_industries?: string[] | null
          desired_role_types?: string[] | null
          dimension_weights?: Json
          id?: string
          innovation_importance?: number | null
          last_ai_profile_review_at?: string | null
          leadership_ambition?: number | null
          leadership_level?: string | null
          mission_importance?: number | null
          preferred_company_sizes?: string[] | null
          preferred_locations?: string[] | null
          preferred_work_styles?: string[] | null
          primary_industry?: string | null
          profile_intent?: string | null
          remote_preference?: string | null
          salary_expectation_max?: number | null
          salary_expectation_min?: number | null
          stability_vs_growth?: number | null
          sustainability_importance?: number | null
          travel_preference?: string | null
          updated_at?: string
          user_id: string
          work_life_balance_importance?: number | null
          years_experience?: number | null
        }
        Update: {
          career_stage?: string | null
          compensation_importance?: number | null
          completeness_score?: number | null
          created_at?: string
          desired_industries?: string[] | null
          desired_role_types?: string[] | null
          dimension_weights?: Json
          id?: string
          innovation_importance?: number | null
          last_ai_profile_review_at?: string | null
          leadership_ambition?: number | null
          leadership_level?: string | null
          mission_importance?: number | null
          preferred_company_sizes?: string[] | null
          preferred_locations?: string[] | null
          preferred_work_styles?: string[] | null
          primary_industry?: string | null
          profile_intent?: string | null
          remote_preference?: string | null
          salary_expectation_max?: number | null
          salary_expectation_min?: number | null
          stability_vs_growth?: number | null
          sustainability_importance?: number | null
          travel_preference?: string | null
          updated_at?: string
          user_id?: string
          work_life_balance_importance?: number | null
          years_experience?: number | null
        }
        Relationships: []
      }
      user_company_ratings: {
        Row: {
          ai_candidate_fit_reasoning: string | null
          ai_candidate_fit_score: number | null
          ai_candidate_fit_updated_at: string | null
          ai_candidate_scenario_notes: Json
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
          ai_candidate_fit_updated_at?: string | null
          ai_candidate_scenario_notes?: Json
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
          ai_candidate_fit_updated_at?: string | null
          ai_candidate_scenario_notes?: Json
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
          {
            foreignKeyName: "user_company_ratings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "employer_search_v1"
            referencedColumns: ["company_id"]
          },
        ]
      }
      user_employer_analysis_weights: {
        Row: {
          ai_weights: Json
          created_at: string
          employer_weights: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_weights: Json
          created_at?: string
          employer_weights: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_weights?: Json
          created_at?: string
          employer_weights?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
          match_score_version: string | null
          match_scored_model: string | null
          relevance_score: number | null
          requirement_summary: Json
          screening_evaluated_at: string | null
          screening_reasons: Json
          screening_status: string | null
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
          match_score_version?: string | null
          match_scored_model?: string | null
          relevance_score?: number | null
          requirement_summary?: Json
          screening_evaluated_at?: string | null
          screening_reasons?: Json
          screening_status?: string | null
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
          match_score_version?: string | null
          match_scored_model?: string | null
          relevance_score?: number | null
          requirement_summary?: Json
          screening_evaluated_at?: string | null
          screening_reasons?: Json
          screening_status?: string | null
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
          card_source: string | null
          card_title: string | null
          created_at: string
          id: string
          identity_fingerprint: string
          legacy_listing_id: string | null
          legacy_listing_status_id: string | null
          match_score_version: string | null
          match_scored_model: string | null
          relevance_score: number | null
          requirement_summary: Json
          screening_evaluated_at: string | null
          screening_reasons: Json
          screening_status: string | null
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
          card_source?: string | null
          card_title?: string | null
          created_at?: string
          id?: string
          identity_fingerprint: string
          legacy_listing_id?: string | null
          legacy_listing_status_id?: string | null
          match_score_version?: string | null
          match_scored_model?: string | null
          relevance_score?: number | null
          requirement_summary?: Json
          screening_evaluated_at?: string | null
          screening_reasons?: Json
          screening_status?: string | null
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
          card_source?: string | null
          card_title?: string | null
          created_at?: string
          id?: string
          identity_fingerprint?: string
          legacy_listing_id?: string | null
          legacy_listing_status_id?: string | null
          match_score_version?: string | null
          match_scored_model?: string | null
          relevance_score?: number | null
          requirement_summary?: Json
          screening_evaluated_at?: string | null
          screening_reasons?: Json
          screening_status?: string | null
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
      employer_search_v1: {
        Row: {
          aarsresultat: number | null
          aarsresultat_margin_prosent: number | null
          agg_career_development_score: number | null
          agg_culture_score: number | null
          agg_financial_stability_score: number | null
          agg_leadership_score: number | null
          agg_mission_score: number | null
          agg_overall_score: number | null
          agg_rating_count: number | null
          agg_work_environment_score: number | null
          ai_career_development_score: number | null
          ai_culture_score: number | null
          ai_dimension_notes: Json | null
          ai_financial_stability_score: number | null
          ai_leadership_score: number | null
          ai_mission_score: number | null
          ai_overall_score: number | null
          ai_rated_at: string | null
          ai_rating_notes: string | null
          ai_work_environment_score: number | null
          aktivitet: string | null
          ansatte_bucket: string | null
          antall_ansatte: number | null
          arbeidsgiver_type: string | null
          available_pdf_years: string[] | null
          company_id: string | null
          datakvalitet_flags: string[] | null
          domain: string | null
          driftsinntekter: number | null
          driftsmargin_prosent: number | null
          driftsresultat: number | null
          driftsresultat_per_ansatt: number | null
          egenkapitalandel_prosent: number | null
          er_i_konsern: boolean | null
          er_offentlig: boolean | null
          er_rekruttering: boolean | null
          er_utdanning: boolean | null
          financials: Json | null
          forretningsadresse_fylke: string | null
          forretningsadresse_fylkesnummer: string | null
          forretningsadresse_kommune: string | null
          forretningsadresse_kommunenummer: string | null
          forretningsadresse_postnummer: string | null
          forretningsadresse_poststed: string | null
          gjeldsgrad: number | null
          har_registrert_antall_ansatte: boolean | null
          hjemmeside: string | null
          institusjonell_sektorkode: string | null
          konkurs: boolean | null
          naeringskode1_beskrivelse: string | null
          naeringskode1_kode: string | null
          naeringskode2_beskrivelse: string | null
          naeringskode2_kode: string | null
          naeringskode3_beskrivelse: string | null
          naeringskode3_kode: string | null
          navn: string | null
          omsetning_bucket: string | null
          omsetning_per_ansatt: number | null
          organisasjonsform_beskrivelse: string | null
          organisasjonsform_kode: string | null
          organisasjonsnummer: string | null
          overordnet_enhet: string | null
          registrert_i_foretaksregisteret: boolean | null
          registrert_i_frivillighetsregisteret: boolean | null
          registrert_i_mvaregisteret: boolean | null
          regnskap_hentet_tidspunkt: string | null
          regnskap_last_checked_at: string | null
          regnskap_last_success_at: string | null
          regnskap_sync_status: string | null
          regnskapsaar: number | null
          regnskapsperiode_fra: string | null
          regnskapsperiode_til: string | null
          regnskapstype: string | null
          risiko_flags: string[] | null
          selskapsalder_aar: number | null
          slettet: boolean | null
          stiftelsesdato: string | null
          sum_anleggsmidler: number | null
          sum_driftskostnad: number | null
          sum_egenkapital: number | null
          sum_egenkapital_gjeld: number | null
          sum_eiendeler: number | null
          sum_finansinntekter: number | null
          sum_finanskostnad: number | null
          sum_gjeld: number | null
          sum_omloepsmidler: number | null
          under_avvikling: boolean | null
          under_tvangsavvikling_eller_tvangsopplosning: boolean | null
          valuta: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _admin_estimated_rows: {
        Args: { p_relation_name: string }
        Returns: number
      }
      _admin_pg_stats_upper_integer: {
        Args: { p_attname: string; p_schemaname: string; p_tablename: string }
        Returns: number
      }
      _admin_pg_stats_upper_text: {
        Args: { p_attname: string; p_schemaname: string; p_tablename: string }
        Returns: string
      }
      _admin_pg_stats_upper_timestamptz: {
        Args: { p_attname: string; p_schemaname: string; p_tablename: string }
        Returns: string
      }
      _careerjet_assert_lease: {
        Args: {
          p_fencing_token: number
          p_lease_name: string
          p_run_id: string
        }
        Returns: undefined
      }
      _careerjet_canonical_recompute_live_until: {
        Args: { p_canonical: string }
        Returns: Json
      }
      _careerjet_is_visible: {
        Args: { p_identity_role: string; p_superseded_by: string }
        Returns: boolean
      }
      _careerjet_norm_text: { Args: { p: string }; Returns: string }
      _careerjet_stable_hash_v1: {
        Args: {
          p_company: string
          p_description: string
          p_employment: Json
          p_location: string
          p_site: string
          p_title: string
        }
        Returns: string
      }
      _careerjet_thread_key: {
        Args: {
          p_fingerprint: string
          p_fp_version: number
          p_generation: number
        }
        Returns: string
      }
      _employer_analysis_default_weights: {
        Args: { p_group: string }
        Returns: Json
      }
      _employer_analysis_expected_keys: {
        Args: { p_group: string }
        Returns: string[]
      }
      _employer_analysis_filter_public_source_ids: {
        Args: { p_valid_ids: number[]; p_value: Json }
        Returns: Json
      }
      _employer_analysis_public_projection: {
        Args: { p_analysis: Json }
        Returns: Json
      }
      _employer_analysis_weighted_score: {
        Args: { p_analysis: Json; p_group: string; p_weights: Json }
        Returns: Json
      }
      _employer_analysis_weights_valid: {
        Args: { p_group: string; p_weights: Json }
        Returns: boolean
      }
      _employer_filter_sql: {
        Args: {
          p_arbeidsgiver_type?: string
          p_bransje_query?: string
          p_fylkesnummer?: string
          p_kommune_query?: string
          p_kommunenummer?: string
          p_max_ansatte?: number
          p_max_omsetning?: number
          p_min_ansatte?: number
          p_min_omsetning?: number
          p_naeringskode_prefix?: string
          p_query?: string
        }
        Returns: Json
      }
      _refresh_company_analysis_atoms: {
        Args: { p_company_id: string }
        Returns: Json
      }
      brreg_full_apply_missing: { Args: { p_run_id: number }; Returns: Json }
      brreg_full_apply_refined_filter: {
        Args: { p_run_id: number }
        Returns: Json
      }
      brreg_full_clear_staging: {
        Args: { p_run_id: number }
        Returns: undefined
      }
      brreg_full_gate_absent: { Args: { p_run_id: number }; Returns: Json }
      brreg_full_gate_counts: { Args: { p_run_id: number }; Returns: Json }
      brreg_full_gate_excluded_in_mirror: {
        Args: { p_run_id: number }
        Returns: Json
      }
      brreg_full_gate_markers: { Args: { p_run_id: number }; Returns: Json }
      brreg_full_gate_metrics: { Args: { p_run_id: number }; Returns: Json }
      brreg_full_gate_overlap: { Args: { p_run_id: number }; Returns: Json }
      brreg_full_get_run: { Args: { p_run_id?: number }; Returns: Json }
      brreg_full_merge:
        | { Args: { p_run_id: number }; Returns: Json }
        | { Args: { p_batch?: number; p_run_id: number }; Returns: Json }
      brreg_full_patch_run: {
        Args: { p_patch: Json; p_run_id: number }
        Returns: Json
      }
      brreg_full_stage_batch: {
        Args: {
          p_excluded: Json
          p_row_cursor: number
          p_rows: Json
          p_rows_seen: number
          p_run_id: number
        }
        Returns: Json
      }
      brreg_full_start_run: { Args: { p_strict?: boolean }; Returns: Json }
      career_atom_delete: { Args: { p_atom_id: string }; Returns: Json }
      career_atom_delete_impact: { Args: { p_atom_id: string }; Returns: Json }
      career_atom_promote_parse_candidate: {
        Args: { p_atom: Json; p_candidate_id: string }
        Returns: Json
      }
      careerjet_canonical_has_visible: {
        Args: { p_canonical: string }
        Returns: boolean
      }
      careerjet_canonicalize_thread: {
        Args: { p_fencing_token: number; p_run_id: string; p_thread_id: string }
        Returns: Json
      }
      careerjet_identity_repair_progress: {
        Args: never
        Returns: {
          cursor_after_fingerprint: string
          ids_adopted: number
          ids_failed: number
          ids_requested: number
          ids_reviewed: number
          ids_superseded: number
          ids_unprocessed: number
          run_id: string
          started_at: string
          status: string
          total_fingerprints: number
        }[]
      }
      careerjet_identity_status: {
        Args: never
        Returns: {
          review_open: number
          source_postings_keeper: number
          source_postings_superseded: number
          source_postings_unresolved: number
          threads_active: number
          threads_review: number
          threads_stale: number
        }[]
      }
      careerjet_lease_claim: {
        Args: { p_lease_name: string; p_run_id: string; p_ttl_seconds?: number }
        Returns: {
          expires_at: string
          fencing_token: number
          granted: boolean
          reason: string
          run_id: string
        }[]
      }
      careerjet_lease_heartbeat: {
        Args: {
          p_fencing_token: number
          p_lease_name: string
          p_run_id: string
          p_ttl_seconds?: number
        }
        Returns: boolean
      }
      careerjet_lease_release: {
        Args: {
          p_fencing_token: number
          p_lease_name: string
          p_run_id: string
        }
        Returns: boolean
      }
      careerjet_resolve_listing: {
        Args: {
          p_fencing_token: number
          p_fp_version: number
          p_identity_fingerprint: string
          p_observation_aliases?: Json
          p_observation_terms?: Json
          p_run_id: string
          p_source_posting_in: Json
        }
        Returns: Json
      }
      careerjet_sync_count_missing_raw_payload: { Args: never; Returns: number }
      careerjet_sync_distinct_external_count: { Args: never; Returns: number }
      careerjet_sync_duplicate_external_ids: {
        Args: never
        Returns: {
          count: number
          external_id: string
        }[]
      }
      careerjet_sync_external_id_prefix_counts: {
        Args: never
        Returns: {
          count: number
          prefix: string
        }[]
      }
      careerjet_sync_last_seen_stats: {
        Args: never
        Returns: {
          active_count: number
          expired_count: number
          max_last_seen: string
          median_last_seen: string
          min_last_seen: string
        }[]
      }
      careerjet_sync_term_coverage: {
        Args: never
        Returns: {
          oldest_last_run_at: string
          run_last_24h: number
          run_last_7d: number
          total_active: number
        }[]
      }
      careerjet_sync_vault_has_secret: { Args: never; Returns: boolean }
      count_employers: {
        Args: {
          p_arbeidsgiver_type?: string
          p_bransje_query?: string
          p_cap?: number
          p_fylkesnummer?: string
          p_kommune_query?: string
          p_kommunenummer?: string
          p_max_ansatte?: number
          p_max_omsetning?: number
          p_min_ansatte?: number
          p_min_omsetning?: number
          p_naeringskode_prefix?: string
          p_query?: string
        }
        Returns: Json
      }
      cron_job_run_details_health: {
        Args: never
        Returns: {
          approx_rows: number
          index_bytes: number
          max_runid: number
          table_bytes: number
          total_bytes: number
        }[]
      }
      cv_variant_db: { Args: { p_variant: string }; Returns: string }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      employer_ansatte_distribution: {
        Args: {
          p_arbeidsgiver_type?: string
          p_bransje_query?: string
          p_cap?: number
          p_fylkesnummer?: string
          p_kommune_query?: string
          p_kommunenummer?: string
          p_max_omsetning?: number
          p_min_omsetning?: number
          p_naeringskode_prefix?: string
          p_query?: string
        }
        Returns: Json
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      ensure_company_for_employer: {
        Args: { p_organisasjonsnummer: string }
        Returns: string
      }
      get_admin_ingestion_status: {
        Args: { p_days?: number; p_timezone?: string }
        Returns: Json
      }
      get_careerjet_sync_cron_info: {
        Args: never
        Returns: {
          active: boolean
          jobname: string
          schedule: string
        }[]
      }
      get_employer_analysis_benchmark_report: {
        Args: { p_benchmark_group_id: string }
        Returns: Json
      }
      get_employer_analysis_context: {
        Args: { p_organisasjonsnummer: string }
        Returns: Json
      }
      get_employer_analysis_view: {
        Args: { p_organisasjonsnummer: string }
        Returns: Json
      }
      get_employer_analysis_weight_config: { Args: never; Returns: Json }
      get_employer_detail: {
        Args: { p_organisasjonsnummer: string }
        Returns: {
          aarsresultat: number | null
          aarsresultat_margin_prosent: number | null
          agg_career_development_score: number | null
          agg_culture_score: number | null
          agg_financial_stability_score: number | null
          agg_leadership_score: number | null
          agg_mission_score: number | null
          agg_overall_score: number | null
          agg_rating_count: number | null
          agg_work_environment_score: number | null
          ai_career_development_score: number | null
          ai_culture_score: number | null
          ai_dimension_notes: Json | null
          ai_financial_stability_score: number | null
          ai_leadership_score: number | null
          ai_mission_score: number | null
          ai_overall_score: number | null
          ai_rated_at: string | null
          ai_rating_notes: string | null
          ai_work_environment_score: number | null
          aktivitet: string | null
          ansatte_bucket: string | null
          antall_ansatte: number | null
          arbeidsgiver_type: string | null
          available_pdf_years: string[] | null
          company_id: string | null
          datakvalitet_flags: string[] | null
          domain: string | null
          driftsinntekter: number | null
          driftsmargin_prosent: number | null
          driftsresultat: number | null
          driftsresultat_per_ansatt: number | null
          egenkapitalandel_prosent: number | null
          er_i_konsern: boolean | null
          er_offentlig: boolean | null
          er_rekruttering: boolean | null
          er_utdanning: boolean | null
          financials: Json | null
          forretningsadresse_fylke: string | null
          forretningsadresse_fylkesnummer: string | null
          forretningsadresse_kommune: string | null
          forretningsadresse_kommunenummer: string | null
          forretningsadresse_postnummer: string | null
          forretningsadresse_poststed: string | null
          gjeldsgrad: number | null
          har_registrert_antall_ansatte: boolean | null
          hjemmeside: string | null
          institusjonell_sektorkode: string | null
          konkurs: boolean | null
          naeringskode1_beskrivelse: string | null
          naeringskode1_kode: string | null
          naeringskode2_beskrivelse: string | null
          naeringskode2_kode: string | null
          naeringskode3_beskrivelse: string | null
          naeringskode3_kode: string | null
          navn: string | null
          omsetning_bucket: string | null
          omsetning_per_ansatt: number | null
          organisasjonsform_beskrivelse: string | null
          organisasjonsform_kode: string | null
          organisasjonsnummer: string | null
          overordnet_enhet: string | null
          registrert_i_foretaksregisteret: boolean | null
          registrert_i_frivillighetsregisteret: boolean | null
          registrert_i_mvaregisteret: boolean | null
          regnskap_hentet_tidspunkt: string | null
          regnskap_last_checked_at: string | null
          regnskap_last_success_at: string | null
          regnskap_sync_status: string | null
          regnskapsaar: number | null
          regnskapsperiode_fra: string | null
          regnskapsperiode_til: string | null
          regnskapstype: string | null
          risiko_flags: string[] | null
          selskapsalder_aar: number | null
          slettet: boolean | null
          stiftelsesdato: string | null
          sum_anleggsmidler: number | null
          sum_driftskostnad: number | null
          sum_egenkapital: number | null
          sum_egenkapital_gjeld: number | null
          sum_eiendeler: number | null
          sum_finansinntekter: number | null
          sum_finanskostnad: number | null
          sum_gjeld: number | null
          sum_omloepsmidler: number | null
          under_avvikling: boolean | null
          under_tvangsavvikling_eller_tvangsopplosning: boolean | null
          valuta: string | null
        }
        SetofOptions: {
          from: "*"
          to: "employer_search_v1"
          isOneToOne: true
          isSetofReturn: true
        }
      }
      get_employer_formaal: {
        Args: { p_organisasjonsnummer: string }
        Returns: string
      }
      get_employer_regnskap_history: {
        Args: { p_organisasjonsnummer: string }
        Returns: Json
      }
      get_nav_repair_cron_info: {
        Args: never
        Returns: {
          active: boolean
          jobname: string
          schedule: string
        }[]
      }
      get_nav_sync_cron_info: {
        Args: never
        Returns: {
          active: boolean
          jobname: string
          schedule: string
        }[]
      }
      get_user_employers: {
        Args: { p_user_id: string }
        Returns: {
          company_id: string
          source: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      internal_ai_begin_regeneration: {
        Args: { p_import_id: string; p_user_id: string }
        Returns: Json
      }
      internal_ai_check_run_limits: {
        Args: {
          p_import_id: string
          p_max_active_per_import?: number
          p_max_active_per_user?: number
          p_max_per_hour?: number
          p_task_key: string
          p_user_id: string
        }
        Returns: Json
      }
      internal_ai_claim_job_step: {
        Args: {
          p_job_kinds?: string[]
          p_max_concurrency?: number
          p_worker_id: string
        }
        Returns: Json
      }
      internal_ai_complete_job: {
        Args: {
          p_job_id: string
          p_model_run_id?: string
          p_result?: Json
          p_status: string
          p_worker_id: string
        }
        Returns: Json
      }
      internal_ai_create_cv_generation: {
        Args: {
          p_atom_ids: string[]
          p_presentation: Json
          p_profile_id: string
          p_readiness: Json
          p_snapshot: Json
          p_snapshot_hash: string
          p_title: string
          p_user_id: string
        }
        Returns: Json
      }
      internal_ai_create_enrichment_batch: {
        Args: { p_batch: Json; p_proposals: Json; p_user_id: string }
        Returns: Json
      }
      internal_ai_enqueue_job: {
        Args: {
          p_document_group_id: string
          p_input?: Json
          p_job_kind: string
          p_max_attempts?: number
          p_opportunity_id?: string
          p_priority?: number
          p_profile_id?: string
          p_rate_limit_per_hour?: number
          p_step_budget_ms?: number
          p_user_id: string
        }
        Returns: Json
      }
      internal_ai_fail_job: {
        Args: {
          p_error?: string
          p_error_code: string
          p_job_id: string
          p_worker_id: string
        }
        Returns: Json
      }
      internal_ai_finish_model_run: {
        Args: {
          p_duration_ms?: number
          p_error_code?: string
          p_http_status?: number
          p_input_tokens?: number
          p_model_run_id: string
          p_outcome?: string
          p_output_tokens?: number
          p_request_id?: string
          p_retry_count?: number
          p_status: string
        }
        Returns: undefined
      }
      internal_ai_generation_commit_step: {
        Args: {
          p_ats: Json
          p_blocks: Json
          p_claims: Json
          p_content_text: string
          p_error_code: string
          p_guard: Json
          p_job_id: string
          p_model_run_id: string
          p_new_version: boolean
          p_next_step: string
          p_output_hash: string
          p_quality: Json
          p_state_patch: Json
          p_step: string
          p_terminal: string
          p_worker_id: string
        }
        Returns: Json
      }
      internal_ai_get_active_profile: {
        Args: { p_task_key: string }
        Returns: Json
      }
      internal_ai_get_cv_generation: {
        Args: { p_job_id: string; p_user_id: string }
        Returns: Json
      }
      internal_ai_get_job_status: {
        Args: { p_job_id: string; p_user_id: string }
        Returns: Json
      }
      internal_ai_job_heartbeat: {
        Args: { p_job_id: string; p_worker_id: string }
        Returns: Json
      }
      internal_ai_reap_stale_jobs: { Args: { p_limit?: number }; Returns: Json }
      internal_ai_requeue_job: {
        Args: {
          p_error?: string
          p_error_code: string
          p_job_id: string
          p_worker_id: string
        }
        Returns: Json
      }
      internal_ai_start_model_run: {
        Args: {
          p_api_version?: string
          p_correlation_id: string
          p_job_id?: string
          p_model_id: string
          p_profile_id?: string
          p_profile_snapshot?: Json
          p_task_key: string
          p_user_id: string
        }
        Returns: string
      }
      link_canonical_to_source: {
        Args: {
          p_canonical: string
          p_merge_reason?: string
          p_posting: string
        }
        Returns: string
      }
      list_regnskap_cron_runs: {
        Args: { p_limit?: number }
        Returns: {
          duration_ms: number
          end_time: string
          jobid: number
          jobname: string
          return_message: string
          runid: number
          start_time: string
          status: string
        }[]
      }
      list_user_careerjet_leads: {
        Args: { p_status?: string }
        Returns: {
          ai_concerns: string
          ai_match_highlights: string
          ai_reasoning: string
          ai_score: number
          ai_scored_at: string
          canonical_opportunity_id: string
          display_url: string
          employer: string
          identity_fingerprint: string
          listing_id: string
          listing_status_id: string
          location: string
          published_at: string
          raw_url: string
          relevance_score: number
          row_kind: string
          salary: string
          salary_currency: string
          salary_max: number
          salary_min: number
          source_url: string
          status: string
          title: string
          user_opportunity_id: string
        }[]
      }
      list_user_job_opportunities: {
        Args: { p_source?: string; p_status?: string }
        Returns: {
          ai_concerns: string
          ai_match_highlights: string
          ai_reasoning: string
          ai_score: number
          ai_scored_at: string
          canonical_opportunity_id: string
          display_url: string
          employer: string
          engagement_type: string
          identity_fingerprint: string
          is_expired: boolean
          linkedin_lead_id: string
          listing_id: string
          listing_status_id: string
          live_until: string
          location: string
          posted_text: string
          published_at: string
          raw_snippet: string
          raw_url: string
          received_at: string
          relevance_score: number
          row_kind: string
          salary: string
          salary_currency: string
          salary_max: number
          salary_min: number
          source: string
          source_email_from: string
          source_subject: string
          source_url: string
          sources: string[]
          status: string
          title: string
          user_opportunity_id: string
          work_extent: string
          work_type: string
        }[]
      }
      mark_stale_careerjet_postings: {
        Args: { p_days?: number }
        Returns: number
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
      nav_sync_count_missing_nav_detail: { Args: never; Returns: number }
      nav_sync_distinct_external_count: { Args: never; Returns: number }
      nav_sync_duplicate_external_ids: {
        Args: never
        Returns: {
          count: number
          external_id: string
        }[]
      }
      nav_sync_repair_progress: {
        Args: never
        Returns: {
          active_run_batches: number
          active_run_cursor_after: string
          active_run_id: string
          active_run_ids_found: number
          active_run_ids_missing: number
          active_run_ids_requested: number
          active_run_rows_failed: number
          active_run_rows_merged: number
          active_run_rows_noop: number
          active_run_rows_stale: number
          active_run_started_at: string
          active_run_status: string
          last_completed_finished_at: string
          last_completed_id: string
          last_completed_status: string
        }[]
      }
      nav_sync_target_cursor: {
        Args: never
        Returns: {
          last_successful_finished_at: string
          last_successful_run_id: string
          latest_cursor_changed_at: string
          latest_cursor_external_id: string
        }[]
      }
      nav_sync_target_inventory: {
        Args: never
        Returns: {
          active: number
          active_missing_detail: number
          active_with_detail: number
          active_with_engagement: number
          active_with_event_version: number
          active_with_extent: number
          duplicate_external_ids: number
          inactive: number
          max_last_seen_at: string
          max_source_event_version: string
          rows_with_event_version: number
          total: number
        }[]
      }
      nav_sync_vault_has_secret: { Args: never; Returns: boolean }
      nav_sync_vault_secret_status: { Args: never; Returns: string }
      nav_target_lease_claim: {
        Args: {
          p_lease_name: string
          p_mode: string
          p_run_id: string
          p_ttl_seconds?: number
        }
        Returns: {
          claimed: boolean
          current_mode: string
          current_run_id: string
          expires_at: string
        }[]
      }
      nav_target_lease_heartbeat: {
        Args: { p_lease_name: string; p_run_id: string; p_ttl_seconds?: number }
        Returns: boolean
      }
      nav_target_lease_release: {
        Args: { p_lease_name: string; p_run_id: string }
        Returns: boolean
      }
      nav_target_lease_status: {
        Args: never
        Returns: {
          acquired_at: string
          expires_at: string
          heartbeat_at: string
          is_stale: boolean
          lease_name: string
          mode: string
          run_id: string
        }[]
      }
      nav_target_repair_tick: { Args: never; Returns: Json }
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
      ops_reap_stuck_runs: {
        Args: { p_older_than_minutes: number; p_source: string }
        Returns: Json
      }
      ops_sync_runs_unified: {
        Args: never
        Returns: {
          error: string
          finished_at: string
          run_id: string
          source: string
          started_at: string
          status: string
        }[]
      }
      ops_watchdog_snapshot: { Args: never; Returns: Json }
      prune_cron_job_run_details: {
        Args: {
          p_batch_size?: number
          p_keep_latest?: number
          p_max_batches?: number
        }
        Returns: {
          batches: number
          deleted_count: number
          max_runid: number
          prune_before_runid: number
        }[]
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
      record_job_match_evaluation: {
        Args: {
          p_job_input_hash: string
          p_model: string
          p_profile_input_hash: string
          p_result: Json
          p_row_id: string
          p_row_kind: string
          p_score_version: string
          p_user_id: string
        }
        Returns: Json
      }
      refresh_company_aggregate: {
        Args: { p_company_id: string }
        Returns: undefined
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
      reset_my_employer_analysis_weights: { Args: never; Returns: undefined }
      review_employer_analysis_model_run: {
        Args: {
          p_analysis_quality: number
          p_factual_accuracy: number
          p_financial_quality: number
          p_notes?: string
          p_run_id: string
          p_scope_precision: number
          p_source_quality: number
        }
        Returns: Json
      }
      search_employers: {
        Args: {
          p_arbeidsgiver_type?: string
          p_bransje_query?: string
          p_fylkesnummer?: string
          p_kommune_query?: string
          p_kommunenummer?: string
          p_limit?: number
          p_max_ansatte?: number
          p_max_omsetning?: number
          p_min_ansatte?: number
          p_min_omsetning?: number
          p_naeringskode_prefix?: string
          p_offset?: number
          p_query?: string
        }
        Returns: {
          aarsresultat: number | null
          aarsresultat_margin_prosent: number | null
          agg_career_development_score: number | null
          agg_culture_score: number | null
          agg_financial_stability_score: number | null
          agg_leadership_score: number | null
          agg_mission_score: number | null
          agg_overall_score: number | null
          agg_rating_count: number | null
          agg_work_environment_score: number | null
          ai_career_development_score: number | null
          ai_culture_score: number | null
          ai_dimension_notes: Json | null
          ai_financial_stability_score: number | null
          ai_leadership_score: number | null
          ai_mission_score: number | null
          ai_overall_score: number | null
          ai_rated_at: string | null
          ai_rating_notes: string | null
          ai_work_environment_score: number | null
          aktivitet: string | null
          ansatte_bucket: string | null
          antall_ansatte: number | null
          arbeidsgiver_type: string | null
          available_pdf_years: string[] | null
          company_id: string | null
          datakvalitet_flags: string[] | null
          domain: string | null
          driftsinntekter: number | null
          driftsmargin_prosent: number | null
          driftsresultat: number | null
          driftsresultat_per_ansatt: number | null
          egenkapitalandel_prosent: number | null
          er_i_konsern: boolean | null
          er_offentlig: boolean | null
          er_rekruttering: boolean | null
          er_utdanning: boolean | null
          financials: Json | null
          forretningsadresse_fylke: string | null
          forretningsadresse_fylkesnummer: string | null
          forretningsadresse_kommune: string | null
          forretningsadresse_kommunenummer: string | null
          forretningsadresse_postnummer: string | null
          forretningsadresse_poststed: string | null
          gjeldsgrad: number | null
          har_registrert_antall_ansatte: boolean | null
          hjemmeside: string | null
          institusjonell_sektorkode: string | null
          konkurs: boolean | null
          naeringskode1_beskrivelse: string | null
          naeringskode1_kode: string | null
          naeringskode2_beskrivelse: string | null
          naeringskode2_kode: string | null
          naeringskode3_beskrivelse: string | null
          naeringskode3_kode: string | null
          navn: string | null
          omsetning_bucket: string | null
          omsetning_per_ansatt: number | null
          organisasjonsform_beskrivelse: string | null
          organisasjonsform_kode: string | null
          organisasjonsnummer: string | null
          overordnet_enhet: string | null
          registrert_i_foretaksregisteret: boolean | null
          registrert_i_frivillighetsregisteret: boolean | null
          registrert_i_mvaregisteret: boolean | null
          regnskap_hentet_tidspunkt: string | null
          regnskap_last_checked_at: string | null
          regnskap_last_success_at: string | null
          regnskap_sync_status: string | null
          regnskapsaar: number | null
          regnskapsperiode_fra: string | null
          regnskapsperiode_til: string | null
          regnskapstype: string | null
          risiko_flags: string[] | null
          selskapsalder_aar: number | null
          slettet: boolean | null
          stiftelsesdato: string | null
          sum_anleggsmidler: number | null
          sum_driftskostnad: number | null
          sum_egenkapital: number | null
          sum_egenkapital_gjeld: number | null
          sum_eiendeler: number | null
          sum_finansinntekter: number | null
          sum_finanskostnad: number | null
          sum_gjeld: number | null
          sum_omloepsmidler: number | null
          under_avvikling: boolean | null
          under_tvangsavvikling_eller_tvangsopplosning: boolean | null
          valuta: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "employer_search_v1"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      set_employer_analysis_weight_profile: {
        Args: { p_ai_weights: Json; p_employer_weights: Json; p_note?: string }
        Returns: Json
      }
      set_my_employer_analysis_weights: {
        Args: { p_ai_weights: Json; p_employer_weights: Json }
        Returns: Json
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
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
      atom_enrichment_batch_status: "open" | "closed" | "cancelled"
      atom_enrichment_proposal_action:
        | "create_atom"
        | "update_atom"
        | "merge_atoms"
        | "deactivate_atom"
        | "flag_conflict"
        | "suggest_positioning"
        | "suggest_narrative"
        | "suggest_evidence"
        | "suggest_preference_clarification"
      atom_enrichment_proposal_status:
        | "pending_review"
        | "approved"
        | "rejected"
        | "merged"
        | "needs_more_context"
        | "superseded"
        | "expired"
      document_type:
        | "cv"
        | "søknadsbrev"
        | "case_dokument"
        | "referanseliste"
        | "annet"
      email_connection_status: "active" | "expired" | "revoked" | "error"
      email_provider: "google" | "microsoft"
      employer_analysis_job_status:
        | "queued"
        | "processing"
        | "completed"
        | "failed"
        | "rate_limited"
      job_lead_status: "ny" | "avvist" | "promotert" | "arkivert"
      priority_level: "høy" | "middels" | "lav"
      survey_question_type:
        | "single_choice"
        | "multi_choice"
        | "scale"
        | "open_text"
        | "ranked_choice"
      survey_visibility: "hidden" | "full_only" | "public"
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
      atom_enrichment_batch_status: ["open", "closed", "cancelled"],
      atom_enrichment_proposal_action: [
        "create_atom",
        "update_atom",
        "merge_atoms",
        "deactivate_atom",
        "flag_conflict",
        "suggest_positioning",
        "suggest_narrative",
        "suggest_evidence",
        "suggest_preference_clarification",
      ],
      atom_enrichment_proposal_status: [
        "pending_review",
        "approved",
        "rejected",
        "merged",
        "needs_more_context",
        "superseded",
        "expired",
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
      employer_analysis_job_status: [
        "queued",
        "processing",
        "completed",
        "failed",
        "rate_limited",
      ],
      job_lead_status: ["ny", "avvist", "promotert", "arkivert"],
      priority_level: ["høy", "middels", "lav"],
      survey_question_type: [
        "single_choice",
        "multi_choice",
        "scale",
        "open_text",
        "ranked_choice",
      ],
      survey_visibility: ["hidden", "full_only", "public"],
    },
  },
} as const
