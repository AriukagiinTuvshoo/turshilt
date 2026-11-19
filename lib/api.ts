const configuredApiBase = process.env.NEXT_PUBLIC_API_BASE_URL?.trim().replace(/\/+$/, '') ?? '';
const developmentApiBase = 'http://localhost:8000/api/v1';

export const API_BASE = configuredApiBase || (process.env.NODE_ENV === 'development' ? developmentApiBase : '');

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string | null = null,
    public requestId: string | null = null,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!API_BASE) {
    throw new ApiError(0, 'API тохиргоо олдсонгүй. Дахин оролдоно уу.', 'API_CONFIGURATION_MISSING');
  }
  let response: Response;
  const isRawBody = init.body instanceof FormData || init.body instanceof Blob;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        ...(init.body && !isRawBody ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(0, 'Холболтод асуудал гарлаа. Дахин оролдоно уу.');
  }
  if (!response.ok) {
    let message = 'Серверийн алдаа гарлаа. Дахин оролдоно уу.';
    let code: string | null = null;
    let requestId = response.headers.get('X-Request-ID');
    try {
      const payload = await response.json();
      code = typeof payload.error_code === 'string' ? payload.error_code : null;
      requestId = typeof payload.request_id === 'string' ? payload.request_id : requestId;
      message =
        response.status === 401 ? 'Нэвтрэх шаардлагатай.' :
        response.status === 403 ? 'Энэ мэдээлэлд хандах эрхгүй.' :
        response.status === 404 ? 'Мэдээлэл олдсонгүй.' :
        response.status === 409 ? 'Энэ үйлдлийг одоогоор гүйцэтгэх боломжгүй байна.' :
        response.status === 422 ? 'Оруулсан мэдээллээ шалгана уу.' :
        response.status === 429 ? 'Хэт олон оролдлого. Түр хүлээгээд дахин оролдоно уу.' :
        payload.detail ?? message;
    } catch {
      // Keep the friendly fallback message when the server sends no JSON.
    }
    throw new ApiError(response.status, message, code, requestId);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export type User = { id: string; email: string | null; display_name: string; person_id: string | null };
export type Family = { id: string; name: string; description: string | null; role: string; created_at?: string };
export type Person = {
  id: string;
  first_name: string;
  last_name: string;
  middle_name: string | null;
  nickname: string | null;
  gender: string;
  birth_date: string | null;
  birth_place: string | null;
  is_alive: boolean;
  death_date: string | null;
  death_place: string | null;
  profile_photo_url?: string | null;
  short_description: string | null;
  visibility: string;
  created_by?: string | null;
  can_edit?: boolean;
  can_delete?: boolean;
  is_minor?: boolean;
  created_at?: string;
  updated_at?: string;
};
export type TreeData = {
  persons: TreePerson[];
  parent_child_relationships: { id: string; parent_id: string; child_id: string; relationship_type: string }[];
  marriages: Marriage[];
  root_person_id?: string | null;
  lineage_root_person_id?: string | null;
  meta?: { depth: number; node_count: number; node_limit: number; truncated: boolean };
};
export type TreePerson = Pick<Person, 'id' | 'first_name' | 'last_name' | 'middle_name' | 'birth_date' | 'is_alive' | 'death_date' | 'profile_photo_url' | 'created_by' | 'can_edit' | 'can_delete'> & {
  gender?: string;
  lineage_id?: string | null;
  lineage_name?: string | null;
  branch_id?: string | null;
  branch_name?: string | null;
};
export type KinshipResult = {
  relationship_type: string;
  relationship_title: string;
  lineage_type: string;
  lineage_label?: string | null;
  degree?: number | null;
  generations_person_1?: number | null;
  generations_person_2?: number | null;
  coefficient: number;
  is_blood_related: boolean;
  within_9_generations: boolean;
  common_ancestor_ids: string[];
  description: string;
  inbreeding_warning?: string | null;
};
export type FamilyStats = {
  total_persons: number;
  male_count: number;
  female_count: number;
  living_count: number;
  deceased_count: number;
  marriage_count: number;
  parent_child_count: number;
  generation_depth: number;
  total_stories: number;
  total_archives: number;
  total_memories: number;
  member_count: number;
};
export type Marriage = { id: string; person_1_id: string; person_2_id: string; status: 'married' | 'divorced' | 'widowed'; start_date: string | null; end_date: string | null; location?: string | null; description?: string | null; created_at?: string; other_person?: Person };
export type ParentChildRelationshipItem = {
  id: string;
  parent_id: string;
  child_id: string;
  relationship_type: 'biological' | 'adoptive';
  created_at?: string;
};
export type SmartConnectOut = {
  created_parent_child_edges: number;
  created_marriages: number;
  created_shared_parent_id?: string | null;
  summary: string;
};
export type ProfileRelationPerson = Pick<
  Person,
  'id' | 'first_name' | 'last_name' | 'middle_name' | 'nickname' | 'gender' | 'birth_date' | 'is_alive' | 'death_date' | 'profile_photo_url'
>;
export type PersonProfile = Person & {
  lineage_id: string | null;
  lineage_name: string | null;
  branch_id: string | null;
  branch_name: string | null;
  parents: ProfileRelationPerson[];
  children: ProfileRelationPerson[];
  spouses: ProfileRelationPerson[];
};

export type PersonSearchPage = { items: { id: string; name: string; birth_year: number | null }[]; page: number; page_size: number; total: number; has_next: boolean };
export type PersonDirectoryItem = Person & {
  lineage_id: string | null;
  lineage_name: string | null;
  branch_id: string | null;
  branch_name: string | null;
};
export type PersonDirectoryPage = {
  items: PersonDirectoryItem[];
  page: number;
  page_size: number;
  total: number;
  has_next: boolean;
};
export type LineageSummary = {
  id: string;
  family_id: string;
  name: string;
  description: string | null;
  created_at?: string;
  updated_at?: string;
};
export type BranchSummary = {
  id: string;
  lineage_id: string;
  name: string;
  description: string | null;
  created_at?: string;
  updated_at?: string;
};

export type ArchivePerson = {
  id: string;
  first_name: string;
  last_name: string;
  middle_name: string | null;
};

export type ArchiveListItem = {
  id: string;
  title: string;
  description: string | null;
  document_date: string | null;
  place: string | null;
  visibility: string;
  author_id: string;
  author_name: string;
  related_people_count: number;
  created_at: string;
  updated_at: string;
};

export type ArchiveListPage = {
  items: ArchiveListItem[];
  page: number;
  page_size: number;
  total: number;
  has_next: boolean;
};

export type Archive = ArchiveListItem & {
  related_people: ArchivePerson[];
};

export type ArchiveInput = {
  title: string;
  description: string | null;
  document_date: string | null;
  place: string | null;
  visibility: 'private' | 'family' | 'public';
  person_ids: string[];
};

export type MemoryListItem = {
  id: string;
  title: string;
  description: string | null;
  memory_date: string | null;
  visibility: string;
  person_ids: string[];
  person_names?: string[];
  created_at: string;
  created_by?: string | null;
  can_edit?: boolean;
  can_delete?: boolean;
  like_count?: number;
  liked_by_me?: boolean;
  liked_by_names?: string[];
  comment_count?: number;
  photos?: {
    id: string;
    title: string | null;
    thumbnail_url: string;
    content_url: string;
    person_ids?: string[];
    tagged_people?: { id: string; name: string }[];
  }[];
};

export type MemoryLikeOut = {
  memory_id: string;
  liked_by_me: boolean;
  like_count: number;
  liked_by_names: string[];
};

export type MemoryCommentItem = {
  id: string;
  memory_id: string;
  user_id: string;
  author_name: string;
  parent_comment_id: string | null;
  body: string;
  created_at: string;
  updated_at: string;
  can_edit: boolean;
  can_delete: boolean;
};

export type StoryPerson = {
  id: string;
  first_name: string;
  last_name: string;
  middle_name: string | null;
};

export type StoryListItem = {
  id: string;
  title: string;
  excerpt: string;
  event_date: string | null;
  place: string | null;
  visibility: string;
  author_id: string;
  author_name: string;
  related_people_count: number;
  created_at: string;
  updated_at: string;
  can_edit?: boolean;
  can_delete?: boolean;
  is_minor?: boolean;
};

export type StoryListPage = {
  items: StoryListItem[];
  page: number;
  page_size: number;
  total: number;
  has_next: boolean;
};

export type Story = StoryListItem & {
  body: string;
  related_people: StoryPerson[];
};

export type LifeEvent = {
  id: string;
  person_id: string;
  event_type: 'birth' | 'school' | 'work' | 'marriage' | 'divorce' | 'child_birth' | 'award' | 'move' | 'death' | 'other' | string;
  title: string;
  event_date: string | null;
  date_note: string | null;
  location: string | null;
  description: string | null;
  created_by?: string;
};

export type ExtractedEventDraft = {
  event_type: string;
  title: string;
  event_date: string | null;
  date_note: string | null;
  location: string | null;
  description: string | null;
};

export type OralHistoryExtractOut = {
  suggested_biography: string;
  extracted_events: ExtractedEventDraft[];
  created_events_count: number;
  biography_updated: boolean;
};

export const personName = (person: Pick<Person, 'first_name' | 'last_name' | 'middle_name'>) =>
  [person.last_name, person.first_name, person.middle_name].filter(Boolean).join(' ');

export type ChatMessage = {
  id: string;
  family_id: string;
  sender_id: string;
  sender_name: string;
  sender_role: string;
  recipient_id: string | null;
  content: string;
  created_at: string;
};

export type ChatMember = {
  user_id: string;
  display_name: string;
  role: string;
  person_id?: string | null;
  person_name?: string | null;
};

export type FamilyTrashItem = {
  id: string;
  person_id: string;
  person_name: string;
  deleted_at: string;
  deleted_by_name: string;
};

export type FamilyImportResult = {
  success: boolean;
  dry_run?: boolean;
  imported_people: number;
  imported_relationships: number;
  imported_marriages: number;
  warnings?: string[];
};

export type Fund = {
  id: string;
  family_id: string;
  title: string;
  purpose: string;
  currency: string;
  payment_instruction: string;
  visibility: 'family' | 'public';
  is_active: boolean;
  confirmed_income_minor: number;
  total_expenses_minor: number;
  net_balance_minor: number;
  created_at: string;
};

export type PublicFund = Fund & {
  family_name: string;
};

export type Donation = {
  id: string;
  fund_id: string;
  amount_minor: number;
  currency: string;
  status: 'pledged' | 'reported' | 'confirmed' | 'cancelled' | string;
  donor_name: string | null;
  private_donor: boolean;
  is_mine?: boolean;
  created_at: string;
};

export type FundExpense = {
  id: string;
  fund_id: string;
  amount_minor: number;
  currency: string;
  title: string;
  note: string;
  spent_at: string;
  recorded_by_name: string | null;
  created_at: string;
};

export type FamilyEvent = {
  id: string;
  family_id: string;
  title: string;
  description: string;
  starts_at: string;
  location: string;
  registration_deadline: string | null;
  capacity: number | null;
  adult_fee_minor: number;
  child_fee_minor: number;
  currency: string;
  payment_instruction: string;
};

export type EventRegistration = {
  id: string;
  event_id: string;
  user_id: string;
  adult_count: number;
  child_count: number;
  status: 'registered' | 'cancelled' | string;
  payment_status: 'unpaid' | 'reported' | 'confirmed' | string;
  created_at: string;
};


