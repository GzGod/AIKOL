import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { badRequest, serverError } from "@/lib/http";

export async function GET() {
  try {
    const groups = await db.accountGroup.findMany({
      include: {
        _count: {
          select: {
            members: true
          }
        }
      },
      orderBy: {
        name: "asc"
      }
    });
    return NextResponse.json({
      data: groups.map((group) => ({
        id: group.id,
        name: group.name,
        description: group.description,
        memberCount: group._count.members
      }))
    });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as {
      name?: string;
      description?: string;
    };
    const name = payload.name?.trim();
    if (!name) {
      return badRequest("分组名称为必填项。");
    }
    const group = await db.accountGroup.upsert({
      where: {
        name
      },
      update: {
        description: payload.description?.trim() || null
      },
      create: {
        name,
        description: payload.description?.trim() || null
      }
    });
    return NextResponse.json({
      data: group
    });
  } catch (error) {
    return serverError(error);
  }
}
