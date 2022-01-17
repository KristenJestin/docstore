using Docstore.Application.Interfaces;
using Docstore.Persistence.Contexts;
using Microsoft.EntityFrameworkCore;

namespace Docstore.Persistence.Repositories
{
    public class GenericRepository<T> : IGenericRepository<T> where T : class
    {
        private readonly AppDbContext _db;

        public GenericRepository(AppDbContext dbContext)
            => _db = dbContext;

        public virtual async Task<T?> FindByIdAsync(int id)
            => await _db.Set<T>().FindAsync(id);

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

        public virtual async Task<IReadOnlyList<T>> GetAllAsync()
            => await _db.Set<T>().ToListAsync();
    }
}