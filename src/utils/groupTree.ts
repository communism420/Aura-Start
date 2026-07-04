import type { AuraStartGroup, GroupTreeNode } from "../types";

export const MAX_GROUP_TREE_DEPTH = 2;

type GroupParentId = AuraStartGroup["parentId"];

function sortedGroups(groups: AuraStartGroup[]): AuraStartGroup[] {
  return groups.slice().sort((a, b) => a.order - b.order);
}

function isValidParentId(groupsById: Map<string, AuraStartGroup>, group: AuraStartGroup): group is AuraStartGroup & { parentId: string } {
  if (!group.parentId || group.parentId === group.id) {
    return false;
  }

  const parent = groupsById.get(group.parentId);
  return Boolean(parent && parent.parentId === null);
}

export function normalizeGroupParentIds(groups: AuraStartGroup[]): AuraStartGroup[] {
  const groupsById = new Map(groups.map((group) => [group.id, group]));

  return groups.map((group) => ({
    ...group,
    parentId: isValidParentId(groupsById, group) ? group.parentId : null
  }));
}

export function normalizeGroupOrders(groups: AuraStartGroup[]): AuraStartGroup[] {
  const normalized = sortedGroups(normalizeGroupParentIds(groups));
  const orderByParent = new Map<GroupParentId, number>();

  return normalized.map((group) => {
    const parentId = group.parentId ?? null;
    const order = orderByParent.get(parentId) ?? 0;
    orderByParent.set(parentId, order + 1);

    return {
      ...group,
      parentId,
      order,
      links: group.links.map((link, linkIndex) => ({ ...link, order: linkIndex }))
    };
  });
}

export function buildGroupTree(groups: AuraStartGroup[]): GroupTreeNode[] {
  const normalized = normalizeGroupParentIds(groups);
  const roots: GroupTreeNode[] = [];
  const childrenByParent = new Map<string, GroupTreeNode[]>();

  sortedGroups(normalized).forEach((group) => {
    const node: GroupTreeNode = {
      ...group,
      depth: group.parentId ? 1 : 0,
      children: []
    };

    if (group.parentId) {
      const children = childrenByParent.get(group.parentId) ?? [];
      children.push(node);
      childrenByParent.set(group.parentId, children);
      return;
    }

    roots.push(node);
  });

  roots.forEach((root) => {
    root.children = childrenByParent.get(root.id) ?? [];
  });

  return roots;
}

export function flattenGroupTree(nodes: GroupTreeNode[]): GroupTreeNode[] {
  return nodes.flatMap((node) => [node, ...flattenGroupTree(node.children)]);
}

export function groupsInTreeOrder(groups: AuraStartGroup[]): AuraStartGroup[] {
  return flattenGroupTree(buildGroupTree(groups)).map(({ children: _children, depth: _depth, ...group }) => group);
}

export function groupTitlePath(groups: AuraStartGroup[], group: AuraStartGroup): string {
  if (!group.parentId) {
    return group.title;
  }

  const parent = groups.find((candidate) => candidate.id === group.parentId);
  return parent ? `${parent.title} / ${group.title}` : group.title;
}
