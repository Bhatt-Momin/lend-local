import { apiRequest } from './api';
import {
  GroupsResponse,
  GroupDetailResponse,
  CreateGroupPayload,
  CreateGroupResponse,
  AddMemberPayload,
  AddMemberResponse,
  LeaveGroupResponse,
  RenameGroupPayload,
  RenameGroupResponse,
  DeleteGroupResponse,
} from '../types/api';

/**
 * Groups API service for managing groups and memberships.
 * Centralizes all /api/groups operations using the shared apiRequest client.
 */
export const groupsApi = {
  /**
   * Fetches all groups for the current user (active memberships and historical debt records).
   * Backend computes myBalance, settlements, and privacy-filtered member/expense counts.
   */
  list: async (): Promise<GroupsResponse> => {
    return apiRequest<GroupsResponse>('/groups');
  },

  /**
   * Fetches detailed information for a single group by ID.
   * Access is permitted for active members and historical participants.
   * Note: Member emails are redacted for departed historical participants.
   */
  getById: async (id: string): Promise<GroupDetailResponse> => {
    return apiRequest<GroupDetailResponse>(`/groups/${id}`);
  },

  /**
   * Creates a new group. The authenticated creator is automatically added as a member.
   * If memberEmails are provided, all must correspond to registered LendLocal accounts.
   */
  create: async (payload: CreateGroupPayload): Promise<CreateGroupResponse> => {
    return apiRequest<CreateGroupResponse>('/groups', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * Adds a new member to the group by registered email address.
   * Caller must be an active member. The target user must already have a registered account.
   */
  addMember: async (groupId: string, payload: AddMemberPayload): Promise<AddMemberResponse> => {
    return apiRequest<AddMemberResponse>(`/groups/${groupId}/members`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * Leaves a group.
   * Restrictions enforced by backend:
   * 1. Group creator cannot leave their own group (must delete instead).
   * 2. Members with unsettled direct debts cannot leave until settled.
   */
  leave: async (groupId: string): Promise<LeaveGroupResponse> => {
    return apiRequest<LeaveGroupResponse>(`/groups/${groupId}/members/me`, {
      method: 'DELETE',
    });
  },

  /**
   * Renames a group.
   * Restricted to the group creator only. Name must be 100 characters or less.
   */
  rename: async (groupId: string, payload: RenameGroupPayload): Promise<RenameGroupResponse> => {
    return apiRequest<RenameGroupResponse>(`/groups/${groupId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  /**
   * Permanently deletes a group and all its associated expenses and payment records.
   * Restrictions enforced by backend:
   * 1. Restricted to group creator only.
   * 2. All balances in the group ledger must be fully settled (net < 0.01) before deletion.
   */
  delete: async (groupId: string): Promise<DeleteGroupResponse> => {
    return apiRequest<DeleteGroupResponse>(`/groups/${groupId}`, {
      method: 'DELETE',
    });
  },
};
