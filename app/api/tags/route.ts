import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { badRequest, serverError } from "@/lib/http";

export async function GET() {
  try {
    const tags = await db.tag.findMany({
      include: {
        _count: {
          select: {
            accountLinks: true
          }
        }
      },
      orderBy: {
        name: "asc"
      }
    });
    return NextResponse.json({
      data: tags.map((tag) => ({
        id: tag.id,
        name: tag.name,
        accountCount: tag._count.accountLinks
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
    };
    const name = payload.name?.trim();
    if (!name) {
      return badRequest("标签名称为必填项。");
    }
    const tag = await db.tag.upsert({
      where: {
        name
      },
      update: {},
      create: {
        name
      }
    });
    return NextResponse.json({ data: tag });
  } catch (error) {
    return serverError(error);
  }
}
