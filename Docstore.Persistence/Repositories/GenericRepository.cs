using Docstore.Application.Interfaces;
using Docstore.Domain.Entities.Abstracts;
using Docstore.Persistence.Contexts;
using Microsoft.EntityFrameworkCore;

namespace Docstore.Persistence.Repositories
{
    public class GenericRepository<T> : IGenericRepository<T> where T : UserOwnsBaseEntity
    {
        private readonly ApplicationDbContext _db;

        public GenericRepository(ApplicationDbContext dbContext)
            => _db = dbContext;

        public virtual async Task<T?> FindByIdAsync(int userId, int id)
            => await _db.Set<T>().Where(x => x.UserId == userId && x.Id == id).FirstOrDefaultAsync();
        public virtual async Task<IReadOnlyList<T>> FindByIdsAsync(int userId, params int[] ids)
        {
            if (ids == null || !ids.Any())
                return Array.Empty<T>();

            return await _db.Set<T>().Where(x => x.UserId == userId).Where(x => ids.Contains(x.Id)).ToListAsync();
        }

        public async Task<T> AddAsync(T entity, bool save = false)
        {
            await _db.Set<T>().AddAsync(entity);

            if (save)
                await _db.SaveChangesAsync();

            return entity;
        }

        public async Task UpdateAsync(T entity, bool save = false)
        {
            _db.Entry(entity).State = EntityState.Modified;

            if (save)
                await _db.SaveChangesAsync();
        }

        public async Task DeleteAsync(T entity, bool save = false)
        {
            _db.Set<T>().Remove(entity);

            if (save)
                await _db.SaveChangesAsync();
        }

        public virtual async Task<IReadOnlyList<T>> GetAllAsync(int user)
            => await _db.Set<T>().Where(x => x.UserId == user).ToListAsync();
    }
}